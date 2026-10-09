import * as z from "zod";
import { audit, requestMeta } from "@/server/audit";
import { hasPortalAccess } from "@/server/auth/roles";
import { getSessionUser } from "@/server/auth/session";
import { LIMITS, rateLimit } from "@/server/rate-limit";
import { downloadFileName } from "@/server/vpn/filename";
import { getOwnedActiveConfig, markDownloaded } from "@/server/vpn/repository";
import { getConfigType } from "@/server/vpn/types";

const NO_STORE = { "Cache-Control": "no-store, private", Pragma: "no-cache" };

function problem(status: number, message: string, extra: Record<string, string> = {}) {
  return Response.json({ error: message }, { status, headers: { ...NO_STORE, ...extra } });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !hasPortalAccess(user.roles)) return problem(401, "Not signed in");

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return problem(404, "Not found");

  const limit = await rateLimit(`download:${user.id}`, LIMITS.download.limit, LIMITS.download.windowSeconds);
  if (!limit.ok) return problem(429, "Too many downloads, try again later", { "Retry-After": String(limit.retryAfter) });

  const meta = requestMeta(request.headers);
  let config;
  try {
    config = await getOwnedActiveConfig(user.id, id);
  } catch (error) {
    // Log the failure class only — never contents or key material.
    console.error("config download failed", { configId: id, error: error instanceof Error ? error.name : "unknown" });
    return problem(500, "Could not prepare the file");
  }
  if (!config) {
    // Same answer for "doesn't exist", "inactive" and "someone else's".
    await audit({
      actor: { oid: user.oid, upn: user.upn },
      action: "access_denied",
      targetConfigId: id,
      meta,
      details: { reason: "config_not_owned_or_inactive", via: "download" },
    });
    return problem(404, "Not found");
  }

  await markDownloaded(config.id);
  await audit({ actor: { oid: user.oid, upn: user.upn }, action: "config_download", targetConfigId: config.id, meta });

  const fileName = downloadFileName(config.type, config.label);
  return new Response(new Uint8Array(config.content), {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": getConfigType(config.type)?.mimeType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Length": String(config.content.length),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Referrer-Policy": "no-referrer",
    },
  });
}
