import { desc, eq, lt, sql } from "drizzle-orm";
import { aad, open } from "../crypto";
import { db, schema, type Connection } from "../db";
import type { AuditActor } from "../audit";
import { isValidPart, normalizeKey } from "../vpn/filename";
import { analyzeImport, commitImport } from "../vpn/import/pipeline";
import { getConfigType } from "../vpn/types";

const q = schema.quarantineItems;

export async function listQuarantine() {
  // Expired items are removed for good (they hold encrypted secrets).
  await db.delete(q).where(lt(q.expiresAt, sql`now()`));
  return db
    .select({
      id: q.id,
      originalFilename: q.originalFilename,
      reason: q.reason,
      parsed: q.parsed,
      sizeBytes: q.sizeBytes,
      source: q.source,
      createdByUpn: q.createdByUpn,
      createdAt: q.createdAt,
      expiresAt: q.expiresAt,
      hasContent: sql<boolean>`${q.ciphertext} is not null`,
    })
    .from(q)
    .orderBy(desc(q.createdAt));
}

export async function deleteQuarantineItem(id: string, connection: Connection = db) {
  const [row] = await connection.delete(q).where(eq(q.id, id)).returning({ originalFilename: q.originalFilename, reason: q.reason });
  return row ?? null;
}

export type ResolveResult =
  | { ok: true; action: string; ownerUpn: string | null }
  | { ok: false; error: "not_found" | "no_content" | "invalid_name" | "owner_locked" | "self_assign"; reason?: string };

/**
 * Accept a quarantined file under a corrected owner/type/label. The content
 * is decrypted only on the server and goes through the normal import
 * pipeline; if it is still invalid, the reason is returned and nothing changes.
 */
export async function resolveQuarantineItem(
  id: string,
  fix: { ownerKey: string; type: string; label: string },
  actor: AuditActor,
  connection: Connection = db,
): Promise<ResolveResult> {
  return connection.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('vpn-config-import'))`);
    const [item] = await tx.select().from(q).where(eq(q.id, id));
    if (!item) return { ok: false, error: "not_found" };
    if (!item.ciphertext || !item.iv || !item.keyId) return { ok: false, error: "no_content" };

    const ownerKey = normalizeKey(fix.ownerKey);
    // A file whose owner was readable from its name keeps that owner: an admin
    // may fix type/label/extension, not hand someone's file to another person.
    const parsedOwner = item.parsed?.ownerKey ? normalizeKey(item.parsed.ownerKey) : "";
    if (isValidPart(parsedOwner) && ownerKey !== parsedOwner) return { ok: false, error: "owner_locked" };
    const label = normalizeKey(fix.label);
    const def = getConfigType(fix.type);
    if (!def || !isValidPart(ownerKey) || !isValidPart(label)) return { ok: false, error: "invalid_name" };

    const original = item.originalFilename.toLowerCase();
    const ext = def.extensions.find((e) => original.endsWith(e)) ?? def.extensions[0]!;
    const bytes = await open({ keyId: item.keyId, iv: item.iv, ciphertext: item.ciphertext }, aad.quarantine(item.id));
    const files = [{ name: `${ownerKey}__${def.id}__${label}${ext}`, bytes }];

    const preview = await analyzeImport(files, tx);
    const bad = preview.items.find((i) => i.action === "quarantine");
    if (bad) return { ok: false, error: "invalid_name", reason: bad.reason ?? undefined };
    // Never route a quarantined file to the admin who is resolving it.
    if (preview.items.some((i) => i.owner?.upn && i.owner.upn === actor.upn)) return { ok: false, error: "self_assign" };

    const result = await commitImport(files, actor, "upload", { connection: tx });
    await tx.delete(q).where(eq(q.id, id));
    const first = result.items[0]!;
    return { ok: true, action: first.action, ownerUpn: first.owner?.upn ?? null };
  });
}
