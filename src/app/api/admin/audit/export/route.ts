import * as z from "zod";
import { exportAudit } from "@/server/admin/audit-log";
import { csvCell } from "@/server/admin/csv";
import { audit, requestMeta } from "@/server/audit";
import { isAdmin } from "@/server/auth/roles";
import { getSessionUser } from "@/server/auth/session";
import { schema } from "@/server/db";

const filters = z.object({
  user: z.string().trim().max(200).optional().transform((v) => v || undefined),
  action: z.enum(schema.auditAction.enumValues).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
});

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !isAdmin(user.roles)) return new Response("Not found", { status: 404 });
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const f = filters.parse(params);
  const rows = await exportAudit({ ...f, page: 1 });

  const header = ["time", "actor_upn", "actor_oid", "action", "target_config_id", "target", "ip", "user_agent", "details"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([r.at, r.actorUpn, r.actorOid, r.action, r.targetConfigId, r.targetLabel, r.ip, r.userAgent, r.details].map(csvCell).join(","));
  }
  await audit({ actor: { oid: user.oid, upn: user.upn }, action: "audit_export", meta: requestMeta(request.headers), details: { ...f, rows: rows.length } });

  const name = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
  // BOM so Excel opens UTF-8 (Cyrillic names) correctly.
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
