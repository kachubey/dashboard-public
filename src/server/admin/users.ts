import { and, asc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema, type Connection } from "../db";
import { isValidPart, normalizeKey } from "../vpn/filename";
import { claimUnclaimedConfigs, type OwnerKeyType } from "../vpn/owners";
import { likePattern, PAGE_SIZE, pageOffset } from "./shared";

const u = schema.user;
const a = schema.ownerAliases;
const c = schema.vpnConfigs;

export async function listUsers(q: string | undefined, page: number) {
  const where = q ? or(ilike(u.upn, likePattern(q)), ilike(u.name, likePattern(q))) : undefined;
  const rows = await db
    .select({
      id: u.id,
      name: u.name,
      upn: u.upn,
      shortUpn: u.shortUpn,
      employeeId: u.employeeId,
      roles: u.roles,
      lastSignInAt: u.lastSignInAt,
    })
    .from(u)
    .where(where)
    .orderBy(asc(u.upn))
    .limit(PAGE_SIZE)
    .offset(pageOffset(page));
  const ids = rows.map((r) => r.id);
  const aliases = ids.length
    ? await db
        .select({ id: a.id, userId: a.userId, keyType: a.keyType, keyValue: a.keyValue, source: a.source })
        .from(a)
        .where(inArray(a.userId, ids))
    : [];
  const counts = ids.length
    ? await db
        .select({ userId: a.userId, n: sql<number>`count(*)::int` })
        .from(c)
        .innerJoin(a, and(eq(a.keyType, c.ownerKeyType), eq(a.keyValue, c.ownerKeyValue), eq(a.userId, c.claimedByUserId)))
        .where(and(eq(c.status, "active"), inArray(a.userId, ids)))
        .groupBy(a.userId)
    : [];
  // Who currently holds each user's own shortUpn key (to flag conflicts).
  const holders = ids.length
    ? await db
        .select({ keyValue: a.keyValue, userId: a.userId, upn: u.upn })
        .from(a)
        .innerJoin(u, eq(u.id, a.userId))
        .where(and(eq(a.keyType, "short_upn"), inArray(a.keyValue, rows.map((r) => r.shortUpn))))
    : [];
  const total = await db.select({ total: sql<number>`count(*)::int` }).from(u).where(where).then((r) => r[0]?.total ?? 0);

  return {
    total,
    rows: rows.map((r) => {
      const holder = holders.find((h) => h.keyValue === r.shortUpn);
      return {
        ...r,
        aliases: aliases.filter((x) => x.userId === r.id),
        activeConfigs: counts.find((x) => x.userId === r.id)?.n ?? 0,
        // Their shortUpn points at someone else (e.g. a reused UPN).
        conflictWith: holder && holder.userId !== r.id ? holder.upn : null,
      };
    }),
  };
}

/** Owner keys that have configs but no alias yet — "waiting for owner". */
export async function listUnlinkedKeys() {
  return db
    .select({
      keyType: c.ownerKeyType,
      keyValue: c.ownerKeyValue,
      configs: sql<number>`count(*)::int`,
      since: sql<Date>`min(${c.createdAt})`,
    })
    .from(c)
    .leftJoin(a, and(eq(a.keyType, c.ownerKeyType), eq(a.keyValue, c.ownerKeyValue)))
    .where(and(isNull(a.id), isNull(c.claimedByUserId), ne(c.status, "deleted")))
    .groupBy(c.ownerKeyType, c.ownerKeyValue)
    .orderBy(sql`min(${c.createdAt})`);
}

export type AliasResult =
  | {
      ok: true;
      previousOwnerUpn: string | null;
      userUpn: string;
      keyType: OwnerKeyType;
      keyValue: string;
      changed: boolean;
      /** Unclaimed configs under the key that now belong to the user. */
      claimed: number;
      /** Configs under the key that stay with their previous owner. */
      keptByPreviousOwner: number;
    }
  | { ok: false; error: "invalid_key" | "user_not_found" | "alias_taken" | "self_assign"; takenBy?: string };

/**
 * Point an owner key at a user. If the key already belongs to someone else,
 * it is only moved when `move` is set. Existing claimed configs keep their
 * previous owner; a fresh import is needed to replace them for the new owner.
 */
export async function setAlias(input: {
  keyType: OwnerKeyType;
  keyValue: string;
  userId: string;
  move: boolean;
  /** The admin doing it — may not assign keys to themselves. */
  actorUserId: string;
}, q: Connection = db): Promise<AliasResult> {
  const keyValue = normalizeKey(input.keyValue);
  if (!isValidPart(keyValue)) return { ok: false, error: "invalid_key" };
  // An admin's own keys come only from their own sign-in; otherwise an admin
  // could point a colleague's key at themselves.
  if (input.userId === input.actorUserId) return { ok: false, error: "self_assign" };
  const [target] = await q.select({ id: u.id, upn: u.upn }).from(u).where(eq(u.id, input.userId));
  if (!target) return { ok: false, error: "user_not_found" };

  return q.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('vpn-config-import'))`);
    const [existing] = await tx
      .select({ id: a.id, userId: a.userId, upn: u.upn })
      .from(a)
      .innerJoin(u, eq(u.id, a.userId))
      .where(and(eq(a.keyType, input.keyType), eq(a.keyValue, keyValue)))
      .for("update");
    const base = { userUpn: target.upn, keyType: input.keyType, keyValue };
    if (existing?.userId === target.id) {
      return { ok: true, ...base, previousOwnerUpn: null, changed: false, claimed: 0, keptByPreviousOwner: 0 };
    }
    if (existing && !input.move) return { ok: false, error: "alias_taken", takenBy: existing.upn };
    if (existing) {
      await tx.update(a).set({ userId: target.id, source: "manual" }).where(eq(a.id, existing.id));
    } else {
      await tx.insert(a).values({ keyType: input.keyType, keyValue, userId: target.id, source: "manual" });
    }
    const claimed = await claimUnclaimedConfigs(target.id, tx, { keyType: input.keyType, keyValue });
    const [{ kept }] = (await tx
      .select({ kept: sql<number>`count(*)::int` })
      .from(c)
      .where(
        and(
          eq(c.ownerKeyType, input.keyType),
          eq(c.ownerKeyValue, keyValue),
          ne(c.status, "deleted"),
          sql`${c.claimedByUserId} is not null and ${c.claimedByUserId} <> ${target.id}`,
        ),
      )) as [{ kept: number }];
    return { ok: true, ...base, previousOwnerUpn: existing?.upn ?? null, changed: true, claimed, keptByPreviousOwner: kept };
  });
}

export async function removeAlias(aliasId: string, q: Connection = db) {
  return q.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('vpn-config-import'))`);
    const [row] = await tx
      .delete(a)
      .where(eq(a.id, aliasId))
      .returning({ keyType: a.keyType, keyValue: a.keyValue, userId: a.userId });
    if (!row) return null;
    const [owner] = await tx.select({ upn: u.upn }).from(u).where(eq(u.id, row.userId));
    return { ...row, upn: owner?.upn ?? null };
  });
}

export async function findUserByUpn(upn: string, q: Connection = db) {
  const [row] = await q.select({ id: u.id, upn: u.upn }).from(u).where(eq(u.upn, upn.trim().toLowerCase()));
  return row ?? null;
}

/** Sign a user out everywhere (e.g. right after removing their role in Entra). */
export async function revokeSessions(userId: string, q: Connection = db) {
  const res = await q.delete(schema.session).where(eq(schema.session.userId, userId)).returning({ id: schema.session.id });
  const [owner] = await q.select({ upn: u.upn, oid: u.oid }).from(u).where(eq(u.id, userId));
  return { count: res.length, upn: owner?.upn ?? null, oid: owner?.oid ?? null };
}
