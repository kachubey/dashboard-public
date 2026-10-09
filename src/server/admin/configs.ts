import { and, desc, eq, ilike, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db, schema, type Connection } from "../db";
import { likePattern, PAGE_SIZE, pageOffset } from "./shared";

// Admin view of configs: metadata, owners, versions. Never contents — admins
// manage configs but can't download other people's files.

const c = schema.vpnConfigs;
const v = schema.vpnConfigVersions;
const a = schema.ownerAliases;
const u = schema.user;

export const CONFIG_STATUS_FILTERS = ["live", "active", "pending", "orphaned", "not_downloaded", "deactivated", "deleted"] as const;
export type ConfigStatusFilter = (typeof CONFIG_STATUS_FILTERS)[number];

export interface ConfigFilters {
  q?: string;
  type?: string;
  status: ConfigStatusFilter;
  page: number;
}

// The owner shown is the person the config is claimed by. The alias join tells
// whether the key still points at them ("orphaned" when it doesn't).
const owner = and(eq(a.keyType, c.ownerKeyType), eq(a.keyValue, c.ownerKeyValue));
const orphaned = sql<boolean>`(${c.claimedByUserId} is not null and ${a.userId} is distinct from ${c.claimedByUserId})`;

function statusWhere(status: ConfigStatusFilter): SQL | undefined {
  switch (status) {
    case "live":
      return ne(c.status, "deleted");
    case "active":
      return eq(c.status, "active");
    case "pending":
      return and(eq(c.status, "active"), isNull(c.claimedByUserId));
    case "orphaned":
      return and(ne(c.status, "deleted"), orphaned);
    case "not_downloaded":
      return and(eq(c.status, "active"), isNull(c.lastDownloadedAt));
    case "deactivated":
      return eq(c.status, "deactivated");
    case "deleted":
      return eq(c.status, "deleted");
  }
}

export async function listConfigs(f: ConfigFilters) {
  const where = and(
    statusWhere(f.status),
    f.type ? eq(c.type, f.type) : undefined,
    f.q
      ? or(
          ilike(c.ownerKeyValue, likePattern(f.q)),
          ilike(c.label, likePattern(f.q)),
          ilike(u.upn, likePattern(f.q)),
          ilike(u.name, likePattern(f.q)),
        )
      : undefined,
  );
  const base = db
    .select({
      id: c.id,
      ownerKeyType: c.ownerKeyType,
      ownerKeyValue: c.ownerKeyValue,
      type: c.type,
      label: c.label,
      status: c.status,
      lastDownloadedAt: c.lastDownloadedAt,
      createdAt: c.createdAt,
      userId: u.id,
      userUpn: u.upn,
      userName: u.name,
      orphaned,
      version: v.version,
      versionAt: v.createdAt,
    })
    .from(c)
    .leftJoin(a, owner)
    .leftJoin(u, eq(u.id, c.claimedByUserId))
    .leftJoin(v, and(eq(v.configId, c.id), eq(v.isActive, true)))
    .where(where);

  const [rows, total] = await Promise.all([
    base.orderBy(desc(sql`coalesce(${v.createdAt}, ${c.updatedAt})`)).limit(PAGE_SIZE).offset(pageOffset(f.page)),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(c)
      .leftJoin(a, owner)
      .leftJoin(u, eq(u.id, c.claimedByUserId))
      .where(where)
      .then((r) => r[0]?.total ?? 0),
  ]);
  return { rows, total };
}

export async function getConfigDetail(id: string) {
  const [config] = await db
    .select({
      id: c.id,
      ownerKeyType: c.ownerKeyType,
      ownerKeyValue: c.ownerKeyValue,
      type: c.type,
      label: c.label,
      status: c.status,
      lastDownloadedAt: c.lastDownloadedAt,
      createdAt: c.createdAt,
      deletedAt: c.deletedAt,
      userId: u.id,
      userUpn: u.upn,
      userName: u.name,
      orphaned,
    })
    .from(c)
    .leftJoin(a, owner)
    .leftJoin(u, eq(u.id, c.claimedByUserId))
    .where(eq(c.id, id))
    .limit(1);
  if (!config) return null;
  const versions = await db
    .select({
      id: v.id,
      version: v.version,
      isActive: v.isActive,
      sha256: v.sha256,
      sizeBytes: v.sizeBytes,
      originalFilename: v.originalFilename,
      source: v.source,
      importedByUpn: v.importedByUpn,
      createdAt: v.createdAt,
    })
    .from(v)
    .where(eq(v.configId, id))
    .orderBy(desc(v.version));
  return { config, versions };
}

export async function setConfigStatus(id: string, status: "active" | "deactivated", q: Connection = db): Promise<boolean> {
  return q.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('vpn-config-import'))`);
    if (status === "active") {
      // Only a config that still has an active version can be served again.
      const [has] = await tx.select({ id: v.id }).from(v).where(and(eq(v.configId, id), eq(v.isActive, true))).limit(1);
      if (!has) return false;
    }
    const res = await tx
      .update(c)
      .set({ status })
      .where(and(eq(c.id, id), ne(c.status, "deleted")))
      .returning({ id: c.id });
    return res.length === 1;
  });
}

/** Make an older version the active one. */
export async function rollbackConfig(configId: string, versionId: string, q: Connection = db): Promise<number | null> {
  return q.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('vpn-config-import'))`);
    const [target] = await tx
      .select({ version: v.version })
      .from(v)
      .where(and(eq(v.id, versionId), eq(v.configId, configId)));
    if (!target) return null;
    await tx.update(v).set({ isActive: false }).where(and(eq(v.configId, configId), eq(v.isActive, true)));
    await tx.update(v).set({ isActive: true }).where(eq(v.id, versionId));
    await tx.update(c).set({ status: "active", deletedAt: null }).where(eq(c.id, configId));
    return target.version;
  });
}

/**
 * Delete = crypto-shred: every encrypted version is removed for good. The
 * config row stays as a tombstone so audit entries keep pointing somewhere.
 */
export async function deleteConfig(id: string, q: Connection = db): Promise<boolean> {
  return q.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('vpn-config-import'))`);
    const res = await tx
      .update(c)
      .set({ status: "deleted", deletedAt: sql`now()` })
      .where(and(eq(c.id, id), ne(c.status, "deleted")))
      .returning({ id: c.id });
    if (res.length !== 1) return false;
    await tx.delete(v).where(eq(v.configId, id));
    return true;
  });
}
