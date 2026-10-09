import { and, asc, eq, sql } from "drizzle-orm";
import { aad, open } from "../crypto";
import { db, schema } from "../db";

// The only queries that read configs on behalf of an employee. Ownership is
// always derived from the *session* user id through owner_aliases — callers
// never pass an owner key or a user id that came from the client.

const c = schema.vpnConfigs;
const v = schema.vpnConfigVersions;
const a = schema.ownerAliases;

export interface UserConfigSummary {
  id: string;
  type: string;
  label: string;
  version: number;
  updatedAt: Date;
  sizeBytes: number;
}

// Both must hold: the owner key currently points at the user, AND the config
// was claimed by that same user. Re-pointing a key at someone else therefore
// never exposes the previous owner's configs.
const ownedBy = (userId: string) =>
  and(
    eq(a.userId, userId),
    eq(a.keyType, c.ownerKeyType),
    eq(a.keyValue, c.ownerKeyValue),
    eq(c.claimedByUserId, userId),
  );

/** Active configs of a user (metadata only — no contents). */
export async function listConfigsForUser(userId: string): Promise<UserConfigSummary[]> {
  return db
    .select({
      id: c.id,
      type: c.type,
      label: c.label,
      version: v.version,
      updatedAt: v.createdAt,
      sizeBytes: v.sizeBytes,
    })
    .from(c)
    .innerJoin(a, ownedBy(userId))
    .innerJoin(v, and(eq(v.configId, c.id), eq(v.isActive, true)))
    .where(eq(c.status, "active"))
    .orderBy(asc(c.type), asc(c.label));
}

export interface DecryptedConfig {
  id: string;
  type: string;
  label: string;
  content: Buffer;
}

/**
 * Decrypt the active version of a config — only if it is active and belongs
 * to `userId`. Returns null otherwise, without saying which check failed.
 */
export async function getOwnedActiveConfig(userId: string, configId: string): Promise<DecryptedConfig | null> {
  const [row] = await db
    .select({
      id: c.id,
      type: c.type,
      label: c.label,
      versionId: v.id,
      keyId: v.keyId,
      iv: v.iv,
      ciphertext: v.ciphertext,
    })
    .from(c)
    .innerJoin(a, ownedBy(userId))
    .innerJoin(v, and(eq(v.configId, c.id), eq(v.isActive, true)))
    .where(and(eq(c.id, configId), eq(c.status, "active")))
    .limit(1);
  if (!row) return null;
  const content = await open(
    { keyId: row.keyId, iv: row.iv, ciphertext: row.ciphertext },
    aad.configVersion(row.id, row.versionId),
  );
  return { id: row.id, type: row.type, label: row.label, content };
}

export async function markDownloaded(configId: string): Promise<void> {
  await db.update(c).set({ lastDownloadedAt: sql`now()` }).where(eq(c.id, configId));
}
