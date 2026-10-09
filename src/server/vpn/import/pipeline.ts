import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { audit, type AuditActor, type RequestMeta } from "../../audit";
import { aad, seal } from "../../crypto";
import { db, schema, type Db, type Connection } from "../../db";
import { loadAliases, ownerResolutionOptions, resolveOwner, type OwnerKeyType } from "../owners";
import { getConfigType } from "../types";
import { decodeText, expandInputs, type Candidate, type InputFile } from "./inputs";

// Shared by the CLI and the admin upload. Two steps:
//   analyzeImport() — dry run: what would happen to every file, no writes;
//   commitImport()  — recomputes the plan inside a transaction and applies it.
// The plan is always recomputed on commit, so a preview that went stale
// (someone else imported meanwhile) can't cause a wrong write.

export type ImportAction = "create" | "replace" | "unchanged" | "quarantine";
export type ImportSource = "upload" | "cli" | "seed";

export interface PlanItem {
  source: string;
  ownerKey: string | null;
  ownerKeyType: OwnerKeyType | null;
  type: string | null;
  label: string | null;
  match: "matched" | "pending" | "invalid";
  owner: { upn: string; name: string } | null;
  action: ImportAction;
  /** Reason code when action = quarantine. */
  reason: string | null;
  existingConfigId: string | null;
  /** True when the config was deactivated/deleted and this import brings it back. */
  reactivates: boolean;
  /**
   * The existing config belonged to someone else (its key was re-pointed or
   * unlinked). Their old versions are destroyed instead of being kept as
   * history, and the config now belongs to the new owner (or nobody yet).
   */
  ownerChange: boolean;
}

export interface ImportSummary {
  create: number;
  replace: number;
  unchanged: number;
  quarantine: number;
  pending: number;
}

export interface ImportPlan {
  items: PlanItem[];
  summary: ImportSummary;
}

interface WorkItem extends PlanItem {
  candidate: Candidate;
  content?: string;
  sha256?: string;
  ownerUserId?: string;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const QUARANTINE_DAYS = 30;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function summarize(items: PlanItem[]): ImportSummary {
  const s: ImportSummary = { create: 0, replace: 0, unchanged: 0, quarantine: 0, pending: 0 };
  for (const i of items) {
    s[i.action] += 1;
    if (i.match === "pending" && i.action !== "quarantine") s.pending += 1;
  }
  return s;
}

/** Strip internal fields (contents, hashes) before a plan leaves the server. */
function publicItem(w: WorkItem): PlanItem {
  return {
    source: w.source,
    ownerKey: w.ownerKey,
    ownerKeyType: w.ownerKeyType,
    type: w.type,
    label: w.label,
    match: w.match,
    owner: w.owner,
    action: w.action,
    reason: w.reason,
    existingConfigId: w.existingConfigId,
    reactivates: w.reactivates,
    ownerChange: w.ownerChange,
  };
}

async function buildPlan(files: InputFile[], q: Db | Tx): Promise<WorkItem[]> {
  const candidates = await expandInputs(files);
  const opts = ownerResolutionOptions();
  const keys = candidates.map((c) => c.parsed?.ownerKey).filter((k): k is string => Boolean(k));
  const aliases = await loadAliases(keys, q);

  const items: WorkItem[] = candidates.map((c) => {
    const base: WorkItem = {
      candidate: c,
      source: c.source,
      ownerKey: c.parsed?.ownerKey ?? c.partial?.ownerKey ?? null,
      ownerKeyType: null,
      type: c.parsed?.type ?? c.partial?.type ?? null,
      label: c.parsed?.label ?? c.partial?.label ?? null,
      match: "invalid",
      owner: null,
      action: "quarantine",
      reason: c.error ?? null,
      existingConfigId: null,
      reactivates: false,
      ownerChange: false,
    };
    if (c.error || !c.parsed) return base;

    const def = getConfigType(c.parsed.type)!;
    const checked = def.validate(decodeText(c.raw));
    if (!checked.ok) return { ...base, reason: checked.reason };

    const owner = resolveOwner(c.parsed.ownerKey, aliases, opts);
    if (owner.status === "ambiguous") return { ...base, reason: "owner_ambiguous" };
    return {
      ...base,
      ownerKeyType: owner.keyType,
      match: owner.status,
      action: "create",
      reason: null,
      content: checked.content,
      sha256: sha256(checked.content),
      ownerUserId: owner.status === "matched" ? owner.userId : undefined,
    };
  });

  // Same owner + type + label twice in one batch: keep the first.
  const seen = new Set<string>();
  for (const item of items) {
    if (item.action === "quarantine") continue;
    const k = `${item.ownerKeyType}:${item.ownerKey}:${item.type}:${item.label}`;
    if (seen.has(k)) Object.assign(item, { action: "quarantine", match: "invalid", reason: "duplicate_in_batch" });
    seen.add(k);
  }

  // Existing configs: by owner key, and — for matched people — by any of their
  // aliases, so a renamed UPN updates the existing config instead of adding a twin.
  const valid = items.filter((i) => i.action !== "quarantine");
  const userIds = [...new Set(valid.map((i) => i.ownerUserId).filter((id): id is string => Boolean(id)))];
  const userAliases = userIds.length
    ? await q.select().from(schema.ownerAliases).where(inArray(schema.ownerAliases.userId, userIds))
    : [];
  const ownerKeys = [...new Set([...valid.map((i) => i.ownerKey!), ...userAliases.map((a) => a.keyValue)])];
  const configs = ownerKeys.length
    ? await q.select().from(schema.vpnConfigs).where(inArray(schema.vpnConfigs.ownerKeyValue, ownerKeys))
    : [];
  const activeVersions = configs.length
    ? await q
        .select({ configId: schema.vpnConfigVersions.configId, sha256: schema.vpnConfigVersions.sha256 })
        .from(schema.vpnConfigVersions)
        .where(and(inArray(schema.vpnConfigVersions.configId, configs.map((c) => c.id)), eq(schema.vpnConfigVersions.isActive, true)))
    : [];
  const users = userIds.length
    ? await q.select({ id: schema.user.id, upn: schema.user.upn, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, userIds))
    : [];

  for (const item of valid) {
    const ownerUserId = item.ownerUserId;
    const keysOfOwner = ownerUserId
      ? userAliases.filter((a) => a.userId === ownerUserId).map((a) => `${a.keyType}:${a.keyValue}`)
      : [];
    const sameSlot = (c: (typeof configs)[number]) => c.type === item.type && c.label === item.label;
    const existing =
      configs.find((c) => sameSlot(c) && c.ownerKeyType === item.ownerKeyType && c.ownerKeyValue === item.ownerKey) ??
      configs.find((c) => sameSlot(c) && c.status !== "deleted" && keysOfOwner.includes(`${c.ownerKeyType}:${c.ownerKeyValue}`));

    if (ownerUserId) {
      const u = users.find((x) => x.id === ownerUserId);
      item.owner = u ? { upn: u.upn, name: u.name } : null;
    }
    if (!existing) continue;
    item.existingConfigId = existing.id;
    const active = activeVersions.find((v) => v.configId === existing.id);
    item.reactivates = existing.status !== "active";
    item.ownerChange = existing.claimedByUserId !== null && existing.claimedByUserId !== (ownerUserId ?? null);
    if (item.ownerChange) item.action = "replace";
    else if (active?.sha256 === item.sha256 && existing.status === "active") item.action = "unchanged";
    else item.action = existing.status === "deleted" || !active ? "create" : "replace";
  }
  return items;
}

/** Dry run. Nothing is written. */
export async function analyzeImport(files: InputFile[], q: Connection = db): Promise<ImportPlan> {
  const items = (await buildPlan(files, q)).map(publicItem);
  return { items, summary: summarize(items) };
}

export async function commitImport(
  files: InputFile[],
  actor: AuditActor,
  batchSource: ImportSource,
  options: { connection?: Connection; meta?: RequestMeta } = {},
): Promise<ImportPlan> {
  return (options.connection ?? db).transaction(async (tx) => {
    // Imports are rare; serializing them keeps version numbering trivially correct.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('vpn-config-import'))`);
    const items = await buildPlan(files, tx);
    const replaced: string[] = [];

    for (const item of items) {
      const source = item.candidate.viaManifest ? ("manifest" as const) : batchSource;

      if (item.action === "quarantine") {
        const raw = item.candidate.raw;
        const rawHash = createHash("sha256").update(raw).digest("hex");
        const [already] = await tx
          .select({ id: schema.quarantineItems.id })
          .from(schema.quarantineItems)
          .where(
            and(
              eq(schema.quarantineItems.originalFilename, item.candidate.originalFilename.slice(0, 255)),
              eq(schema.quarantineItems.sha256, rawHash),
              gt(schema.quarantineItems.expiresAt, sql`now()`),
            ),
          )
          .limit(1);
        if (already) continue;
        const id = randomUUID();
        const sealed = raw.length ? await seal(raw, aad.quarantine(id)) : null;
        await tx.insert(schema.quarantineItems).values({
          id,
          originalFilename: item.candidate.originalFilename.slice(0, 255),
          reason: item.reason ?? "unknown",
          parsed: { ownerKey: item.ownerKey ?? undefined, type: item.type ?? undefined, label: item.label ?? undefined },
          keyId: sealed?.keyId ?? null,
          iv: sealed?.iv ?? null,
          ciphertext: sealed?.ciphertext ?? null,
          sizeBytes: raw.length,
          sha256: rawHash,
          source,
          createdByOid: actor.oid,
          createdByUpn: actor.upn,
          expiresAt: new Date(Date.now() + QUARANTINE_DAYS * 86_400_000),
        });
        continue;
      }
      if (item.action === "unchanged") continue;

      let configId = item.existingConfigId;
      if (configId) {
        if (item.ownerChange) {
          // The previous owner's secrets must not become the new owner's history.
          await tx.delete(schema.vpnConfigVersions).where(eq(schema.vpnConfigVersions.configId, configId));
          await tx
            .update(schema.vpnConfigs)
            .set({ claimedByUserId: item.ownerUserId ?? null, lastDownloadedAt: null })
            .where(eq(schema.vpnConfigs.id, configId));
        } else if (item.ownerUserId) {
          await tx
            .update(schema.vpnConfigs)
            .set({ claimedByUserId: item.ownerUserId })
            .where(and(eq(schema.vpnConfigs.id, configId), isNull(schema.vpnConfigs.claimedByUserId)));
        }
        await tx
          .update(schema.vpnConfigs)
          .set({ status: "active", deletedAt: null })
          .where(eq(schema.vpnConfigs.id, configId));
        await tx
          .update(schema.vpnConfigVersions)
          .set({ isActive: false })
          .where(and(eq(schema.vpnConfigVersions.configId, configId), eq(schema.vpnConfigVersions.isActive, true)));
      } else {
        const [row] = await tx
          .insert(schema.vpnConfigs)
          .values({
            ownerKeyType: item.ownerKeyType!,
            ownerKeyValue: item.ownerKey!,
            type: item.type!,
            label: item.label!,
            claimedByUserId: item.ownerUserId ?? null,
          })
          .returning({ id: schema.vpnConfigs.id });
        configId = row!.id;
      }

      const [{ next }] = (await tx
        .select({ next: sql<number>`coalesce(max(${schema.vpnConfigVersions.version}), 0) + 1` })
        .from(schema.vpnConfigVersions)
        .where(eq(schema.vpnConfigVersions.configId, configId))) as [{ next: number }];

      const versionId = randomUUID();
      const plaintext = Buffer.from(item.content!, "utf8");
      const sealed = await seal(plaintext, aad.configVersion(configId, versionId));
      await tx.insert(schema.vpnConfigVersions).values({
        id: versionId,
        configId,
        version: Number(next),
        isActive: true,
        keyId: sealed.keyId,
        iv: sealed.iv,
        ciphertext: sealed.ciphertext,
        sha256: item.sha256!,
        sizeBytes: plaintext.length,
        originalFilename: item.candidate.originalFilename.slice(0, 255),
        source,
        importedByOid: actor.oid,
        importedByUpn: actor.upn,
      });
      item.existingConfigId = configId;
      if (item.action === "replace") replaced.push(configId);
    }
    const publicItems = items.map(publicItem);
    const summary = summarize(publicItems);
    await audit({ actor, action: "import_commit", meta: options.meta, details: { source: batchSource, ...summary } }, tx);
    for (const configId of replaced) {
      await audit({ actor, action: "config_replace", targetConfigId: configId, meta: options.meta, details: { via: batchSource } }, tx);
    }
    return { items: publicItems, summary };
  });
}
