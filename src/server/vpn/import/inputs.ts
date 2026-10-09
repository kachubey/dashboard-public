import { parse as parseCsv } from "csv-parse/sync";
import { Readable } from "node:stream";
import { extract } from "tar-stream";
import { isValidPart, normalizeKey, parseFileName, type ParsedName } from "../filename";
import { pritunlNames, pritunlOwnerKey, readPritunlHeader } from "../pritunl";
import { getConfigType } from "../types";

// Turns raw uploaded/dropped files into candidates: one candidate per config.
// A Pritunl .tar may hold several .ovpn files; a .csv manifest holds many rows.

export interface InputFile {
  name: string;
  bytes: Buffer;
}

export interface Candidate {
  /** What the admin sees: "alice__pritunl__main.ovpn", "links.csv:3", "x.tar › a.ovpn". */
  source: string;
  /** File name used for the version record. */
  originalFilename: string;
  parsed: ParsedName | null;
  partial?: Partial<ParsedName>;
  /** Raw bytes as received (kept for quarantine). */
  raw: Buffer;
  error?: string;
  viaManifest: boolean;
}

export const LIMITS = {
  maxFiles: 500,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  maxTarEntries: 50,
  maxManifestRows: 2000,
  /** After unpacking .tar files and manifests. */
  maxCandidates: 2000,
  maxExpandedBytes: 50 * 1024 * 1024,
};

export class InputError extends Error {
  override name = "InputError";
}

export function decodeText(bytes: Buffer): string {
  const text = bytes.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function checkLimits(files: InputFile[]): void {
  if (files.length === 0) throw new InputError("no_files");
  if (files.length > LIMITS.maxFiles) throw new InputError("too_many_files");
  const total = files.reduce((n, f) => n + f.bytes.length, 0);
  if (total > LIMITS.maxTotalBytes) throw new InputError("batch_too_large");
}

async function readTar(bytes: Buffer): Promise<{ name: string; bytes: Buffer }[]> {
  const ex = extract();
  const entries: { name: string; bytes: Buffer }[] = [];
  let count = 0;
  const done = new Promise<void>((resolve, reject) => {
    ex.on("entry", (header, stream, next) => {
      count += 1;
      const base = header.name.split("/").pop() ?? "";
      const wanted =
        count <= LIMITS.maxTarEntries &&
        header.type === "file" &&
        base.toLowerCase().endsWith(".ovpn") &&
        (header.size ?? 0) <= LIMITS.maxFileBytes;
      if (!wanted) {
        stream.resume();
        stream.on("end", next);
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (c: unknown) => chunks.push(c as Buffer));
      stream.on("end", () => {
        entries.push({ name: base, bytes: Buffer.concat(chunks) });
        next();
      });
      stream.on("error", reject);
    });
    ex.on("finish", resolve);
    ex.on("error", reject);
  });
  Readable.from(bytes).pipe(ex);
  await done;
  return entries;
}

/** "org_alice_main-server.ovpn" → "main-server"-ish label suffix. */
function labelSuffix(innerName: string): string {
  return innerName
    .toLowerCase()
    .replace(/\.ovpn$/, "")
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

async function expandFile(
  name: string,
  raw: Buffer,
  parsed: ParsedName,
  viaManifest: boolean,
  source: string,
): Promise<Candidate[]> {
  return (await expandNamedFile(name, raw, parsed, viaManifest, source)).map(checkPritunlOwner);
}

/**
 * A renamed Pritunl profile must still belong to the owner in its name: the
 * profile authenticates as the Pritunl user in its header, so handing
 * alice's file to smith would let smith connect as alice.
 */
function checkPritunlOwner(c: Candidate): Candidate {
  if (c.parsed?.type !== "pritunl") return c;
  const profile = readPritunlHeader(decodeText(c.raw));
  if (!profile || pritunlOwnerKey(profile.user) === c.parsed.ownerKey) return c;
  return { ...c, parsed: null, partial: c.parsed, error: "pritunl_owner_mismatch" };
}

async function expandNamedFile(
  name: string,
  raw: Buffer,
  parsed: ParsedName,
  viaManifest: boolean,
  source: string,
): Promise<Candidate[]> {
  if (parsed.extension !== ".tar") {
    return [{ source, originalFilename: name, parsed, raw, viaManifest }];
  }
  let entries: { name: string; bytes: Buffer }[];
  try {
    entries = await readTar(raw);
  } catch {
    return [{ source, originalFilename: name, parsed: null, partial: parsed, raw, error: "tar_unreadable", viaManifest }];
  }
  if (entries.length === 0) {
    return [{ source, originalFilename: name, parsed: null, partial: parsed, raw, error: "tar_no_ovpn", viaManifest }];
  }
  return entries.map((e) => {
    const label = entries.length === 1 ? parsed.label : `${parsed.label}-${labelSuffix(e.name)}`;
    const value = { ...parsed, label, extension: ".ovpn" };
    const ok = isValidPart(label);
    return {
      source: `${source} › ${e.name}`,
      originalFilename: e.name,
      parsed: ok ? value : null,
      partial: value,
      raw: e.bytes,
      error: ok ? undefined : "name_bad_label",
      viaManifest,
    };
  });
}

/** One .ovpn exported by Pritunl: owner and label come from its profile header. */
function pritunlCandidate(name: string, raw: Buffer, source: string): Candidate {
  const base = { source, originalFilename: name, raw, viaManifest: false };
  const profile = readPritunlHeader(decodeText(raw));
  if (!profile) return { ...base, parsed: null, partial: { type: "pritunl" }, error: "pritunl_no_header" };
  const names = pritunlNames(profile);
  if (!names.ok) {
    return { ...base, parsed: null, partial: { type: "pritunl", ownerKey: names.ownerKey, label: names.label }, error: names.reason };
  }
  return { ...base, parsed: { ownerKey: names.ownerKey, type: "pritunl", label: names.label, extension: ".ovpn" } };
}

/**
 * A file straight from Pritunl, not renamed: `alice.tar` holding
 * `Org_alice_server.ovpn` files, or one of those .ovpn files on its own.
 */
async function expandPritunlNative(name: string, raw: Buffer): Promise<Candidate[]> {
  if (!name.toLowerCase().endsWith(".tar")) return [pritunlCandidate(name, raw, name)];
  let entries: { name: string; bytes: Buffer }[];
  try {
    entries = await readTar(raw);
  } catch {
    return [{ source: name, originalFilename: name, parsed: null, partial: { type: "pritunl" }, raw, error: "tar_unreadable", viaManifest: false }];
  }
  if (entries.length === 0) {
    return [{ source: name, originalFilename: name, parsed: null, partial: { type: "pritunl" }, raw, error: "tar_no_ovpn", viaManifest: false }];
  }
  return entries.map((e) => pritunlCandidate(e.name, e.bytes, `${name} › ${e.name}`));
}

/** No "__" in the name and a Pritunl extension → treat it as a Pritunl download. */
function isPritunlNativeName(base: string): boolean {
  const lower = base.toLowerCase();
  return !lower.includes("__") && (lower.endsWith(".tar") || lower.endsWith(".ovpn"));
}

interface ManifestRow {
  ownerKey?: string;
  type?: string;
  label?: string;
  content_or_filename?: string;
}

async function expandManifest(
  manifest: InputFile,
  byName: Map<string, InputFile>,
  consumed: Set<string>,
): Promise<Candidate[]> {
  let rows: ManifestRow[];
  try {
    rows = parseCsv(decodeText(manifest.bytes), {
      columns: (header: string[]) => header.map((h) => h.trim()),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch {
    return [{ source: manifest.name, originalFilename: manifest.name, parsed: null, raw: manifest.bytes, error: "manifest_unreadable", viaManifest: true }];
  }
  if (rows.length > LIMITS.maxManifestRows) {
    return [{ source: manifest.name, originalFilename: manifest.name, parsed: null, raw: Buffer.alloc(0), error: "manifest_too_many_rows", viaManifest: true }];
  }

  const out: Candidate[] = [];
  for (const [i, row] of rows.entries()) {
    const source = `${manifest.name}:${i + 2}`; // +1 header, +1 to be 1-based
    const ownerKey = normalizeKey(row.ownerKey ?? "");
    const type = normalizeKey(row.type ?? "");
    const label = normalizeKey(row.label ?? "");
    const value = (row.content_or_filename ?? "").trim();
    const partial = { ownerKey, type, label };
    const def = getConfigType(type);

    let error: string | undefined;
    if (!isValidPart(ownerKey)) error = "name_bad_owner_key";
    else if (!def) error = "name_unknown_type";
    else if (!isValidPart(label)) error = "name_bad_label";
    else if (!value) error = "manifest_empty_value";

    // Inline content (typically a vless:// link) or a reference to another file in the batch.
    const inline = value.includes("://") || value.includes("\n");
    const referenced = !inline && value ? byName.get(value.toLowerCase()) : undefined;
    if (!error && !inline && !referenced) error = "manifest_file_not_found";
    // Each file may be used once — otherwise one row-heavy manifest could
    // multiply a large file thousands of times.
    if (!error && referenced && consumed.has(referenced.name.toLowerCase())) error = "manifest_file_reused";
    if (!error && referenced && referenced.bytes.length > LIMITS.maxFileBytes) error = "too_large";
    const raw = inline ? Buffer.from(value, "utf8") : (referenced?.bytes ?? Buffer.alloc(0));

    if (error || !def) {
      // Rows rejected for their name keep no bytes: nothing to accept later
      // without the file anyway, and no way to amplify storage.
      out.push({ source, originalFilename: source, parsed: null, partial, raw: Buffer.alloc(0), error, viaManifest: true });
      continue;
    }
    if (referenced) consumed.add(referenced.name.toLowerCase());
    const extension = referenced
      ? referenced.name.slice(referenced.name.lastIndexOf(".")).toLowerCase()
      : def.extensions[0]!;
    if (!def.extensions.includes(extension)) {
      out.push({ source, originalFilename: source, parsed: null, partial, raw, error: "name_extension_mismatch", viaManifest: true });
      continue;
    }
    out.push(
      ...(await expandFile(
        referenced?.name ?? `${ownerKey}__${type}__${label}${extension}`,
        raw,
        { ownerKey, type, label, extension },
        true,
        source,
      )),
    );
  }
  return out;
}

/** Expand a batch of files into config candidates (no DB access). */
export async function expandInputs(files: InputFile[]): Promise<Candidate[]> {
  checkLimits(files);
  const byName = new Map(files.map((f) => [f.name.split(/[\\/]/).pop()!.toLowerCase(), f]));
  const consumed = new Set<string>();
  const candidates: Candidate[] = [];

  for (const manifest of files.filter((f) => f.name.toLowerCase().endsWith(".csv"))) {
    candidates.push(...(await expandManifest(manifest, byName, consumed)));
  }
  for (const file of files) {
    const base = file.name.split(/[\\/]/).pop()!;
    if (base.toLowerCase().endsWith(".csv") || consumed.has(base.toLowerCase())) continue;
    if (file.bytes.length > LIMITS.maxFileBytes) {
      candidates.push({ source: base, originalFilename: base, parsed: null, raw: Buffer.alloc(0), error: "too_large", viaManifest: false });
      continue;
    }
    if (isPritunlNativeName(base)) {
      candidates.push(...(await expandPritunlNative(base, file.bytes)));
      continue;
    }
    const parsed = parseFileName(base);
    if (!parsed.ok) {
      candidates.push({ source: base, originalFilename: base, parsed: null, partial: parsed.partial, raw: file.bytes, error: parsed.reason, viaManifest: false });
      continue;
    }
    candidates.push(...(await expandFile(base, file.bytes, parsed.value, false, base)));
  }
  const expanded = candidates.reduce((n, c) => n + c.raw.length, 0);
  if (candidates.length > LIMITS.maxCandidates || expanded > LIMITS.maxExpandedBytes) {
    throw new InputError("batch_too_large");
  }
  return candidates;
}
