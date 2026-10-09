import { isValidPart, normalizeKey } from "./filename";

// Pritunl writes a JSON profile header as `#`-prefixed comment lines at the top
// of every .ovpn it exports:
//
//   #{
//   # "user": "alice",
//   # "organization": "ExampleOrg",
//   # "server": "office-main-vpn",
//   # … (ids, keys, sync token — never read here)
//   #}
//
// The download is `<user>.tar` with `<organization>_<user>_<server>.ovpn`
// inside. Owner and label come from the header rather than the file name: the
// header is unambiguous, while `_` may also appear inside organization or
// server names.

export interface PritunlProfile {
  user: string;
  server: string;
  organization: string | null;
}

/** Reads user/server/organization from a Pritunl header, or null if there is none. */
export function readPritunlHeader(text: string): PritunlProfile | null {
  const lines: string[] = [];
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!line.startsWith("#")) break;
    lines.push(line.slice(1));
  }
  const body = lines.join("\n").trim();
  if (!body.startsWith("{")) return null;
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const { user, server, organization } = data as Record<string, unknown>;
  if (typeof user !== "string" || !user.trim() || typeof server !== "string" || !server.trim()) return null;
  return { user, server, organization: typeof organization === "string" ? organization : null };
}

/** Pritunl user name → owner key: lowercase, and the part before "@" if it is a full UPN. */
export function pritunlOwnerKey(user: string): string {
  const key = normalizeKey(user);
  return key.includes("@") ? key.slice(0, key.indexOf("@")) : key;
}

/** Pritunl server name → config label: "Office Main_VPN" → "office-main-vpn". */
export function pritunlLabel(server: string): string {
  return server
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 64)
    .replace(/[.-]+$/, "");
}

/** Owner key and label for a Pritunl profile, or the reason they can't be used. */
export function pritunlNames(
  profile: PritunlProfile,
): { ok: true; ownerKey: string; label: string } | { ok: false; reason: string; ownerKey?: string; label?: string } {
  const ownerKey = pritunlOwnerKey(profile.user);
  const label = pritunlLabel(profile.server);
  if (!isValidPart(ownerKey)) return { ok: false, reason: "name_bad_owner_key", label };
  if (!isValidPart(label)) return { ok: false, reason: "name_bad_label", ownerKey };
  return { ok: true, ownerKey, label };
}
