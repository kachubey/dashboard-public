import { and, desc, eq, gte, ilike, lt, sql } from "drizzle-orm";
import { db, schema } from "../db";
import type { AuditAction } from "../audit";
import { likePattern, PAGE_SIZE, pageOffset } from "./shared";

const l = schema.auditLog;
const c = schema.vpnConfigs;

export interface AuditFilters {
  user?: string;
  action?: AuditAction;
  from?: string; // yyyy-mm-dd, inclusive
  to?: string; // yyyy-mm-dd, inclusive
  page: number;
}

function where(f: AuditFilters) {
  return and(
    f.user ? ilike(l.actorUpn, likePattern(f.user)) : undefined,
    f.action ? eq(l.action, f.action) : undefined,
    f.from ? gte(l.at, new Date(`${f.from}T00:00:00Z`)) : undefined,
    f.to ? lt(l.at, new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000)) : undefined,
  );
}

const columns = {
  id: l.id,
  at: l.at,
  actorUpn: l.actorUpn,
  actorOid: l.actorOid,
  action: l.action,
  targetConfigId: l.targetConfigId,
  targetLabel: sql<string | null>`case when ${c.id} is null then null else ${c.ownerKeyValue} || ' / ' || ${c.type} || ' / ' || ${c.label} end`,
  ip: sql<string | null>`host(${l.ip})`,
  userAgent: l.userAgent,
  details: l.details,
};

export async function queryAudit(f: AuditFilters) {
  const w = where(f);
  const [rows, total] = await Promise.all([
    db
      .select(columns)
      .from(l)
      .leftJoin(c, sql`${c.id}::text = ${l.targetConfigId}`)
      .where(w)
      .orderBy(desc(l.id))
      .limit(PAGE_SIZE)
      .offset(pageOffset(f.page)),
    db.select({ total: sql<number>`count(*)::int` }).from(l).where(w).then((r) => r[0]?.total ?? 0),
  ]);
  return { rows, total };
}

export const EXPORT_MAX_ROWS = 50_000;

export async function exportAudit(f: AuditFilters) {
  return db
    .select(columns)
    .from(l)
    .leftJoin(c, sql`${c.id}::text = ${l.targetConfigId}`)
    .where(where(f))
    .orderBy(desc(l.id))
    .limit(EXPORT_MAX_ROWS);
}
