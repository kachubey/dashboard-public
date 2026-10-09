"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import * as z from "zod";
import { deleteConfig, rollbackConfig, setConfigStatus } from "@/server/admin/configs";
import { deleteQuarantineItem, resolveQuarantineItem } from "@/server/admin/quarantine";
import { findUserByUpn, removeAlias, revokeSessions, setAlias } from "@/server/admin/users";
import { audit, requestMeta, type AuditAction } from "@/server/audit";
import { requireAdmin } from "@/server/auth/session";
import { db, type Transaction } from "@/server/db";
import { CONFIG_TYPES } from "@/server/vpn/types";

// Every admin mutation: role check → input validation → change → audit.
// Results carry a translation key (admin.result.*) and values for the toast.

export interface ActionResult {
  ok: boolean;
  message: string;
  values?: Record<string, string>;
}

const id = z.uuid();
const fail = (message: string, values?: Record<string, string>): ActionResult => ({ ok: false, message, values });

type RecordChange = (action: AuditAction, targetConfigId: string | null, details?: Record<string, unknown>) => Promise<void>;

async function adminTransaction(work: (tx: Transaction, record: RecordChange) => Promise<ActionResult>): Promise<ActionResult> {
  const admin = await requireAdmin();
  const actor = { oid: admin.oid, upn: admin.upn };
  const meta = requestMeta(await headers());
  const result = await db.transaction(async (tx) => work(tx, (action, targetConfigId, details) =>
    audit({ actor, action, targetConfigId, meta, details }, tx)));
  if (result.ok) revalidatePath("/admin", "layout");
  return result;
}

function done(message: string, values?: Record<string, string>): ActionResult {
  return { ok: true, message, values };
}

export async function setConfigStatusAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const input = z.object({ configId: id, status: z.enum(["active", "deactivated"]) }).safeParse(Object.fromEntries(form));
  if (!input.success) return fail("failed");
  return adminTransaction(async (tx, record) => {
    const changed = await setConfigStatus(input.data.configId, input.data.status, tx);
    if (!changed) return fail(input.data.status === "active" ? "no_reactivate" : "not_found");
    const reactivate = input.data.status === "active";
    await record(reactivate ? "config_reactivate" : "config_deactivate", input.data.configId);
    return done(reactivate ? "config_reactivated" : "config_deactivated");
  });
}

export async function rollbackConfigAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const input = z.object({ configId: id, versionId: id }).safeParse(Object.fromEntries(form));
  if (!input.success) return fail("failed");
  return adminTransaction(async (tx, record) => {
    const version = await rollbackConfig(input.data.configId, input.data.versionId, tx);
    if (version === null) return fail("not_found");
    await record("config_rollback", input.data.configId, { toVersion: version });
    return done("config_rolled_back", { version: String(version) });
  });
}

export async function deleteConfigAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const input = z.object({ configId: id }).safeParse(Object.fromEntries(form));
  if (!input.success) return fail("failed");
  return adminTransaction(async (tx, record) => {
    if (!(await deleteConfig(input.data.configId, tx))) return fail("not_found");
    await record("config_delete", input.data.configId);
    return done("config_deleted");
  });
}

export async function setAliasAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const input = z
    .object({
      keyType: z.enum(["short_upn", "employee_code"]),
      keyValue: z.string().trim().min(1).max(64),
      // Either an id (user rows) or a UPN typed by the admin (waiting-for-owner list).
      userId: z.string().min(1).max(64).optional(),
      userUpn: z.string().trim().min(3).max(256).optional(),
      move: z.literal("on").optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return fail("invalid_key");
  return adminTransaction(async (tx, record) => {
    const userId = input.data.userId ?? (input.data.userUpn ? (await findUserByUpn(input.data.userUpn, tx))?.id : undefined);
    if (!userId) return fail("user_not_found");
    const result = await setAlias({
      keyType: input.data.keyType,
      keyValue: input.data.keyValue,
      userId,
      move: input.data.move === "on",
      actorUserId: admin.id,
    }, tx);
    if (!result.ok) {
      return fail(result.error, { key: input.data.keyValue, upn: result.takenBy ?? "" });
    }
    if (result.changed) {
      await record("alias_update", null, {
        keyType: result.keyType,
        keyValue: result.keyValue,
        to: result.userUpn,
        from: result.previousOwnerUpn,
        claimed: result.claimed,
        keptByPreviousOwner: result.keptByPreviousOwner,
      });
    }
    return done(result.keptByPreviousOwner > 0 ? "alias_saved_kept" : "alias_saved", {
      key: result.keyValue,
      upn: result.userUpn,
      claimed: String(result.claimed),
      kept: String(result.keptByPreviousOwner),
    });
  });
}

export async function removeAliasAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const input = z.object({ aliasId: id }).safeParse(Object.fromEntries(form));
  if (!input.success) return fail("failed");
  return adminTransaction(async (tx, record) => {
    const removed = await removeAlias(input.data.aliasId, tx);
    if (!removed) return fail("not_found");
    await record("alias_update", null, { keyType: removed.keyType, keyValue: removed.keyValue, from: removed.upn, to: null });
    return done("alias_removed", { key: removed.keyValue });
  });
}

export async function resolveQuarantineAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const input = z
    .object({
      itemId: id,
      ownerKey: z.string().trim().min(1).max(64),
      type: z.enum(CONFIG_TYPES.map((t) => t.id) as [string, ...string[]]),
      label: z.string().trim().min(1).max(64),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success) return fail("quarantine_invalid", { reason: "name_pattern" });
  return adminTransaction(async (tx, record) => {
    const { itemId, ...fix } = input.data;
    const result = await resolveQuarantineItem(itemId, fix, { oid: admin.oid, upn: admin.upn }, tx);
    if (!result.ok) {
      return fail(result.error === "invalid_name" ? "quarantine_invalid" : result.error, { reason: result.reason ?? "name_pattern" });
    }
    await record("quarantine_resolve", null, { item: itemId, ...fix, result: result.action });
    return done("quarantine_resolved");
  });
}

export async function deleteQuarantineAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const input = z.object({ itemId: id }).safeParse(Object.fromEntries(form));
  if (!input.success) return fail("failed");
  return adminTransaction(async (tx, record) => {
    const removed = await deleteQuarantineItem(input.data.itemId, tx);
    if (!removed) return fail("not_found");
    await record("quarantine_delete", null, { item: input.data.itemId, file: removed.originalFilename, reason: removed.reason });
    return done("quarantine_deleted");
  });
}

export async function revokeSessionsAction(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireAdmin();
  const input = z.object({ userId: z.string().min(1).max(64) }).safeParse(Object.fromEntries(form));
  if (!input.success) return fail("failed");
  return adminTransaction(async (tx, record) => {
    const result = await revokeSessions(input.data.userId, tx);
    await record("sessions_revoke", null, { user: result.upn, oid: result.oid, sessions: result.count });
    return done("sessions_revoked", { count: String(result.count), upn: result.upn ?? "" });
  });
}
