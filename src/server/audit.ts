import { isIP } from "node:net";
import { db, schema, type Connection } from "./db";

export type AuditAction = (typeof schema.auditAction.enumValues)[number];

export interface AuditActor {
  oid: string | null;
  upn: string | null;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface AuditEntry {
  actor: AuditActor;
  action: AuditAction;
  targetConfigId?: string | null;
  meta?: RequestMeta;
  details?: Record<string, unknown>;
}

/** Append one audit record. Never pass config contents or secrets in `details`. */
export async function audit(entry: AuditEntry, q: Pick<Connection, "insert"> = db): Promise<void> {
  await q.insert(schema.auditLog).values({
    actorOid: entry.actor.oid,
    actorUpn: entry.actor.upn,
    action: entry.action,
    targetConfigId: entry.targetConfigId ?? null,
    ip: normalizeIp(entry.meta?.ip ?? null),
    userAgent: entry.meta?.userAgent?.slice(0, 512) ?? null,
    details: entry.details ?? null,
  });
}

/**
 * Client IP and user agent from request headers. In production the app is
 * reachable only through Caddy, which sets X-Forwarded-For; the first entry
 * is the client.
 */
export function requestMeta(headers: Headers): RequestMeta {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: forwarded || headers.get("x-real-ip") || null,
    userAgent: headers.get("user-agent"),
  };
}

// The column is `inet`; anything that doesn't look like an address is dropped
// rather than failing the audit insert.
function normalizeIp(ip: string | null): string | null {
  if (!ip) return null;
  const v = ip.replace(/^::ffff:/, "");
  return isIP(v) ? v : null;
}
