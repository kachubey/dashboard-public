import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema, type Connection } from "../db";
import { env } from "../env";

export type OwnerKeyType = (typeof schema.ownerKeyType.enumValues)[number];

export interface AliasRow {
  keyType: OwnerKeyType;
  keyValue: string;
  userId: string;
  /** A stale auto alias or a known directory collision cannot receive imports. */
  blocked?: boolean;
}

export type OwnerResolution =
  | { status: "matched"; keyType: OwnerKeyType; userId: string }
  | { status: "pending"; keyType: OwnerKeyType }
  | { status: "ambiguous" };

/**
 * Decide who an owner key belongs to, given every alias with that key value.
 * Pure function — the DB lookup lives in `resolveOwnerKeys`.
 *
 * - one alias → that user
 * - a shortUpn alias and an employee-code alias with the same value pointing
 *   at different people → ambiguous (goes to quarantine)
 * - no alias → pending; the key type is guessed from EMPLOYEE_CODE_REGEX
 */
export function resolveOwner(
  key: string,
  aliases: readonly AliasRow[],
  opts: { employeeCodes: boolean; employeeCodePattern: RegExp },
): OwnerResolution {
  const hits = aliases.filter((a) => a.keyValue === key);
  if (hits.some((a) => a.blocked)) return { status: "ambiguous" };
  const users = new Set(hits.map((a) => a.userId));
  if (users.size > 1) return { status: "ambiguous" };
  if (hits.length > 0) {
    // Prefer the shortUpn alias when both exist for the same person.
    const hit = hits.find((a) => a.keyType === "short_upn") ?? hits[0]!;
    return { status: "matched", keyType: hit.keyType, userId: hit.userId };
  }
  const keyType: OwnerKeyType =
    opts.employeeCodes && opts.employeeCodePattern.test(key) ? "employee_code" : "short_upn";
  return { status: "pending", keyType };
}

export function ownerResolutionOptions() {
  const e = env();
  return {
    employeeCodes: e.FEATURE_EMPLOYEE_ID,
    employeeCodePattern: new RegExp(e.EMPLOYEE_CODE_REGEX, "i"),
  };
}

export async function loadAliases(keys: string[], q: Connection = db): Promise<AliasRow[]> {
  if (keys.length === 0) return [];
  const rows = await q
    .select({
      keyType: schema.ownerAliases.keyType,
      keyValue: schema.ownerAliases.keyValue,
      userId: schema.ownerAliases.userId,
      source: schema.ownerAliases.source,
      shortUpn: schema.user.shortUpn,
      employeeId: schema.user.employeeId,
    })
    .from(schema.ownerAliases)
    .innerJoin(schema.user, eq(schema.user.id, schema.ownerAliases.userId))
    .where(inArray(schema.ownerAliases.keyValue, [...new Set(keys)]));
  const directory = await q.select({ id: schema.user.id, shortUpn: schema.user.shortUpn, employeeId: schema.user.employeeId })
    .from(schema.user).where(or(inArray(schema.user.shortUpn, keys), inArray(schema.user.employeeId, keys)));
  return rows.map((a) => ({
    keyType: a.keyType, keyValue: a.keyValue, userId: a.userId,
    blocked: a.source === "auto" && (
      a.keyValue !== (a.keyType === "short_upn" ? a.shortUpn : a.employeeId?.trim().toLowerCase()) ||
      directory.some((u) => u.id !== a.userId && (u.shortUpn === a.keyValue || u.employeeId?.trim().toLowerCase() === a.keyValue))
    ),
  }));
}

/**
 * Called after every successful sign-in: make sure the user's shortUpn (and
 * employee code, if known) point at them. An alias that already points at
 * someone else is NOT taken over — that would hand a previous owner's configs
 * to a new person who got a reused UPN. Such conflicts are returned so they
 * can be audited and resolved by an admin.
 */
export async function linkAliasesOnSignIn(u: {
  id: string;
  shortUpn: string;
  employeeId: string | null;
}, q: Connection = db): Promise<{ keyType: OwnerKeyType; keyValue: string; ownerUserId: string }[]> {
  return q.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('vpn-config-import'))`);
    const wanted: { keyType: OwnerKeyType; keyValue: string }[] = [
      { keyType: "short_upn", keyValue: u.shortUpn.toLowerCase() },
    ];
    if (env().FEATURE_EMPLOYEE_ID && u.employeeId) {
      wanted.push({ keyType: "employee_code", keyValue: u.employeeId.trim().toLowerCase() });
    }

    await tx
      .insert(schema.ownerAliases)
      .values(wanted.map((w) => ({ ...w, userId: u.id, source: "auto" as const })))
      .onConflictDoNothing({ target: [schema.ownerAliases.keyType, schema.ownerAliases.keyValue] });

    await claimUnclaimedConfigs(u.id, tx);

    const existing = await tx
      .select()
      .from(schema.ownerAliases)
      .where(
        or(...wanted.map((w) => and(eq(schema.ownerAliases.keyType, w.keyType), eq(schema.ownerAliases.keyValue, w.keyValue)))),
      );
    return existing
      .filter((a) => a.userId !== u.id)
      .map((a) => ({ keyType: a.keyType, keyValue: a.keyValue, ownerUserId: a.userId }));
  });
}

/**
 * Claim every not-yet-claimed config whose owner key points at this user.
 * Called after a sign-in and after an admin links a key; configs already
 * claimed by someone else are left alone.
 */
export async function claimUnclaimedConfigs(userId: string, q: Connection = db, onlyKey?: { keyType: OwnerKeyType; keyValue: string }): Promise<number> {
  const c = schema.vpnConfigs;
  const a = schema.ownerAliases;
  const aliases = await q.select().from(a).where(eq(a.userId, userId));
  const candidates = await loadAliases(aliases.map((v) => v.keyValue), q);
  const safe = candidates.filter((v) => {
    const resolution = resolveOwner(v.keyValue, candidates, ownerResolutionOptions());
    return resolution.status === "matched" && resolution.userId === userId && v.userId === userId &&
      (!onlyKey || (v.keyType === onlyKey.keyType && v.keyValue === onlyKey.keyValue));
  });
  if (!safe.length) return 0;
  const res = await q
    .update(c)
    .set({ claimedByUserId: userId })
    .where(
      and(
        isNull(c.claimedByUserId),
        or(...safe.map((v) => and(eq(c.ownerKeyType, v.keyType), eq(c.ownerKeyValue, v.keyValue)))),
        sql`exists (select 1 from ${a} where ${a.userId} = ${userId} and ${a.keyType} = ${c.ownerKeyType} and ${a.keyValue} = ${c.ownerKeyValue})`,
      ),
    )
    .returning({ id: c.id });
  return res.length;
}
