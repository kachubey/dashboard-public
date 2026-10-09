"use server";

import { headers } from "next/headers";
import * as z from "zod";
import { audit, requestMeta } from "@/server/audit";
import { requireUser } from "@/server/auth/session";
import { LIMITS, rateLimit } from "@/server/rate-limit";
import { getOwnedActiveConfig } from "@/server/vpn/repository";
import { getConfigType } from "@/server/vpn/types";

export type RevealResult = { ok: true; link: string } | { ok: false; error: "not_found" | "rate_limited" | "failed" };

/** Show a VLESS link in the page. Every reveal is audited. */
export async function revealConfig(configId: string): Promise<RevealResult> {
  const user = await requireUser();
  if (!z.uuid().safeParse(configId).success) return { ok: false, error: "not_found" };

  const limit = await rateLimit(`reveal:${user.id}`, LIMITS.reveal.limit, LIMITS.reveal.windowSeconds);
  if (!limit.ok) return { ok: false, error: "rate_limited" };

  const meta = requestMeta(await headers());
  let config;
  try {
    config = await getOwnedActiveConfig(user.id, configId);
  } catch (error) {
    console.error("config reveal failed", { configId, error: error instanceof Error ? error.name : "unknown" });
    return { ok: false, error: "failed" };
  }
  if (!config || !getConfigType(config.type)?.revealable) {
    await audit({
      actor: { oid: user.oid, upn: user.upn },
      action: "access_denied",
      targetConfigId: configId,
      meta,
      details: { reason: "config_not_owned_or_inactive", via: "reveal" },
    });
    return { ok: false, error: "not_found" };
  }
  await audit({ actor: { oid: user.oid, upn: user.upn }, action: "config_reveal", targetConfigId: config.id, meta });
  return { ok: true, link: config.content.toString("utf8").trim() };
}
