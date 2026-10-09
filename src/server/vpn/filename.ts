import { getConfigType } from "./types";

// File naming convention for manual drops (case-insensitive):
//
//   <ownerKey>__<type>__<label>.<ext>
//   alice__pritunl__main.ovpn
//   alice__vless__nl-1.txt
//   E1042__wg__office-a.conf
//
// ownerKey and label: letters, digits, dot, dash, underscore (but never a
// double underscore, which is the separator).

export interface ParsedName {
  ownerKey: string;
  type: string;
  label: string;
  extension: string;
}

export type ParseResult = { ok: true; value: ParsedName } | { ok: false; reason: string; partial?: Partial<ParsedName> };

const PART = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const MAX_PART = 64;

export function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidPart(value: string): boolean {
  return value.length <= MAX_PART && PART.test(value) && !value.includes("__");
}

export function parseFileName(fileName: string): ParseResult {
  // Only the base name counts; directories in uploads are ignored.
  const base = fileName.split(/[\\/]/).pop()!.trim().toLowerCase();
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "name_missing_extension" };
  const extension = base.slice(dot);
  const parts = base.slice(0, dot).split("__");
  if (parts.length !== 3) return { ok: false, reason: "name_pattern" };
  const [ownerKey, type, label] = parts as [string, string, string];
  const partial = { ownerKey, type, label, extension };

  if (!isValidPart(ownerKey)) return { ok: false, reason: "name_bad_owner_key", partial };
  const def = getConfigType(type);
  if (!def) return { ok: false, reason: "name_unknown_type", partial };
  if (!isValidPart(label)) return { ok: false, reason: "name_bad_label", partial };
  if (!def.extensions.includes(extension)) return { ok: false, reason: "name_extension_mismatch", partial };
  return { ok: true, value: partial };
}

/** Download file name, e.g. "pritunl-main.ovpn". */
export function downloadFileName(type: string, label: string): string {
  const def = getConfigType(type);
  return `${type}-${label}${def?.downloadExtension ?? ".txt"}`;
}
