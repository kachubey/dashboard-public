// Integration tests against a real PostgreSQL (TEST_DATABASE_URL).
// The database is wiped and migrated at the start of the run.
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const enabled = Boolean(process.env.TEST_DATABASE_URL);

// The download route reads the session through this module; tests choose who is signed in.
const session = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock("@/server/auth/session", () => ({
  getSessionUser: async () => session.current,
  requireUser: async () => session.current,
}));

describe.skipIf(!enabled)("integration (database)", async () => {
  const { db, schema } = await import("@/server/db");
  const { upsertDirectoryUser } = await import("@/server/auth/users");
  const { linkAliasesOnSignIn } = await import("@/server/vpn/owners");
  const { analyzeImport, commitImport } = await import("@/server/vpn/import/pipeline");
  const { listConfigsForUser, getOwnedActiveConfig } = await import("@/server/vpn/repository");
  const { GET: download } = await import("@/app/api/vpn/configs/[id]/download/route");

  const actor = { oid: null, upn: "test" };
  const ovpn = (n: string) => `client\nremote ${n}.example.test 1194\n`;
  const file = (name: string, content: string) => ({ name, bytes: Buffer.from(content) });

  async function signUp(oid: string, upn: string) {
    const u = await upsertDirectoryUser({ oid, upn, name: upn, roles: ["Portal.User"], employeeId: null });
    await linkAliasesOnSignIn(u);
    return u;
  }

  function asSessionUser(u: { id: string; oid: string; upn: string; shortUpn: string }) {
    return { ...u, name: u.upn, roles: ["Portal.User"], locale: null, isAdmin: false };
  }

  async function configId(owner: string, type: string, label: string) {
    const [row] = await db
      .select({ id: schema.vpnConfigs.id })
      .from(schema.vpnConfigs)
      .where(sql`${schema.vpnConfigs.ownerKeyValue} = ${owner} and ${schema.vpnConfigs.type} = ${type} and ${schema.vpnConfigs.label} = ${label}`);
    return row!.id;
  }

  beforeEach(async () => {
    session.current = null;
    await db.execute(sql`truncate vpn_config_versions, vpn_configs, owner_aliases, quarantine_items, rate_limits, "user" cascade`);
  });

  afterAll(async () => {
    const pool = (globalThis as { pgPool?: Pool }).pgPool;
    await pool?.end();
  });

  it("user A never sees or downloads user B's configs", async () => {
    const a = await signUp("aaaaaaaa-0000-4000-8000-000000000001", "alice@test.example");
    const b = await signUp("bbbbbbbb-0000-4000-8000-000000000002", "bob@test.example");
    await commitImport([file("alice__pritunl__main.ovpn", ovpn("a")), file("bob__pritunl__main.ovpn", ovpn("b"))], actor, "cli");
    const bobs = await configId("bob", "pritunl", "main");

    expect((await listConfigsForUser(a.id)).map((c) => c.label)).toEqual(["main"]);
    expect(await getOwnedActiveConfig(a.id, bobs)).toBeNull();
    expect((await getOwnedActiveConfig(b.id, bobs))?.content.toString()).toContain("b.example.test");

    // Through the HTTP route, as Alice: same 404 as for a config that doesn't exist.
    session.current = asSessionUser(a);
    const res = await download(new Request("http://x/"), { params: Promise.resolve({ id: bobs }) });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("example.test");
  });

  it("serves the owner's file with no-store and attachment headers, and audits it", async () => {
    const a = await signUp("aaaaaaaa-0000-4000-8000-000000000001", "alice@test.example");
    await commitImport([file("alice__wg__office.conf", "[Interface]\nPrivateKey = k\n[Peer]\nPublicKey = p\n")], actor, "cli");
    const id = await configId("alice", "wg", "office");
    session.current = asSessionUser(a);
    const res = await download(new Request("http://x/"), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("content-disposition")).toContain('filename="wg-office.conf"');
    expect(await res.text()).toContain("PrivateKey = k");
    const [cfg] = await db.select().from(schema.vpnConfigs).where(eq(schema.vpnConfigs.id, id));
    expect(cfg!.lastDownloadedAt).not.toBeNull();
  });

  it("refuses anonymous downloads", async () => {
    const res = await download(new Request("http://x/"), { params: Promise.resolve({ id: crypto.randomUUID() }) });
    expect(res.status).toBe(401);
  });

  it("pending configs appear after the owner's first sign-in", async () => {
    const plan = await analyzeImport([file("carol__pritunl__main.ovpn", ovpn("c"))]);
    expect(plan.items[0]).toMatchObject({ match: "pending", action: "create" });
    await commitImport([file("carol__pritunl__main.ovpn", ovpn("c"))], actor, "cli");
    const carol = await signUp("cccccccc-0000-4000-8000-000000000003", "Carol@test.example");
    expect(await listConfigsForUser(carol.id)).toHaveLength(1);
  });

  it("re-import makes a new version; only the active one is served", async () => {
    const a = await signUp("aaaaaaaa-0000-4000-8000-000000000001", "alice@test.example");
    await commitImport([file("alice__pritunl__main.ovpn", ovpn("v1"))], actor, "cli");
    const same = await analyzeImport([file("alice__pritunl__main.ovpn", ovpn("v1"))]);
    expect(same.items[0]!.action).toBe("unchanged");
    const result = await commitImport([file("alice__pritunl__main.ovpn", ovpn("v2"))], actor, "cli");
    expect(result.items[0]!.action).toBe("replace");

    const id = await configId("alice", "pritunl", "main");
    const versions = await db.select().from(schema.vpnConfigVersions).where(eq(schema.vpnConfigVersions.configId, id));
    expect(versions.map((v) => [v.version, v.isActive]).sort()).toEqual([[1, false], [2, true]]);
    expect((await getOwnedActiveConfig(a.id, id))?.content.toString()).toContain("v2");
  });

  it("deactivated configs are not downloadable", async () => {
    const a = await signUp("aaaaaaaa-0000-4000-8000-000000000001", "alice@test.example");
    await commitImport([file("alice__pritunl__main.ovpn", ovpn("a"))], actor, "cli");
    const id = await configId("alice", "pritunl", "main");
    await db.update(schema.vpnConfigs).set({ status: "deactivated" }).where(eq(schema.vpnConfigs.id, id));
    expect(await getOwnedActiveConfig(a.id, id)).toBeNull();
    expect(await listConfigsForUser(a.id)).toHaveLength(0);
  });

  it("linking a waiting key to a person claims its configs for them", async () => {
    const { setAlias } = await import("@/server/admin/users");
    const admin = await signUp("99999999-0000-4000-8000-000000000009", "admin@test.example");
    const a = await signUp("aaaaaaaa-0000-4000-8000-000000000001", "alice@test.example");
    await commitImport([file("alicia-typo__pritunl__main.ovpn", ovpn("x"))], actor, "cli");
    expect(await listConfigsForUser(a.id)).toHaveLength(0);
    const r = await setAlias({ keyType: "short_upn", keyValue: "alicia-typo", userId: a.id, move: false, actorUserId: admin.id });
    expect(r).toMatchObject({ ok: true, claimed: 1, keptByPreviousOwner: 0 });
    expect(await listConfigsForUser(a.id)).toHaveLength(1);
  });

  it("a reused UPN does not inherit the previous owner's configs", async () => {
    await signUp("aaaaaaaa-0000-4000-8000-000000000001", "alice@test.example");
    await commitImport([file("alice__pritunl__main.ovpn", ovpn("old"))], actor, "cli");
    const newcomer = await upsertDirectoryUser({ oid: "dddddddd-0000-4000-8000-000000000004", upn: "alice@test.example", name: "New Alice", roles: ["Portal.User"], employeeId: null });
    // Same UPN, different object id: upsert by oid creates a separate user...
    const conflicts = await linkAliasesOnSignIn(newcomer);
    // ...and the existing alias is reported, not taken over.
    expect(conflicts).toHaveLength(1);
    expect(await listConfigsForUser(newcomer.id)).toHaveLength(0);
  });

  it("a ciphertext copied onto another row cannot be decrypted", async () => {
    const a = await signUp("aaaaaaaa-0000-4000-8000-000000000001", "alice@test.example");
    const b = await signUp("bbbbbbbb-0000-4000-8000-000000000002", "bob@test.example");
    await commitImport([file("alice__pritunl__main.ovpn", ovpn("a")), file("bob__pritunl__main.ovpn", ovpn("b"))], actor, "cli");
    const aId = await configId("alice", "pritunl", "main");
    const bId = await configId("bob", "pritunl", "main");
    const [bv] = await db.select().from(schema.vpnConfigVersions).where(eq(schema.vpnConfigVersions.configId, bId));
    // An attacker with database write access pastes Bob's secret into Alice's row.
    await db
      .update(schema.vpnConfigVersions)
      .set({ iv: bv!.iv, ciphertext: bv!.ciphertext, keyId: bv!.keyId })
      .where(eq(schema.vpnConfigVersions.configId, aId));
    await expect(getOwnedActiveConfig(a.id, aId)).rejects.toThrow(/Decryption failed/);
    expect(b).toBeTruthy();
  });

  it("invalid files go to quarantine, encrypted, once", async () => {
    const files = [file("broken.ovpn", "client\n"), file("x__wg__y.conf", "nonsense")];
    const first = await commitImport(files, actor, "cli");
    expect(first.summary.quarantine).toBe(2);
    await commitImport(files, actor, "cli");
    const rows = await db.select().from(schema.quarantineItems);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.ciphertext && !r.ciphertext.includes(Buffer.from("nonsense")))).toBe(true);
    expect(rows.map((r) => r.reason).sort()).toEqual(["pritunl_no_header", "wg_missing_interface"]);
  });

  it("admin: moving someone's key never hands over their configs", async () => {
    const { setAlias } = await import("@/server/admin/users");
    const admin = await signUp("99999999-0000-4000-8000-000000000009", "admin@test.example");
    const a = await signUp("aaaaaaaa-0000-4000-8000-000000000001", "alice@test.example");
    const b = await signUp("bbbbbbbb-0000-4000-8000-000000000002", "bob@test.example");
    await commitImport([file("alice__pritunl__main.ovpn", ovpn("a"))], actor, "cli");
    const id = await configId("alice", "pritunl", "main");

    expect(await setAlias({ keyType: "short_upn", keyValue: "Alice", userId: b.id, move: false, actorUserId: admin.id })).toMatchObject({ ok: false, error: "alias_taken", takenBy: "alice@test.example" });
    const moved = await setAlias({ keyType: "short_upn", keyValue: "alice", userId: b.id, move: true, actorUserId: admin.id });
    expect(moved).toMatchObject({ ok: true, previousOwnerUpn: "alice@test.example", claimed: 0, keptByPreviousOwner: 1 });
    // Bob now holds the key but not Alice's file; Alice no longer holds the key.
    expect(await listConfigsForUser(b.id)).toHaveLength(0);
    expect(await getOwnedActiveConfig(b.id, id)).toBeNull();
    expect(await listConfigsForUser(a.id)).toHaveLength(0);

    // A fresh file for Bob under that key replaces the config and destroys Alice's versions.
    const plan = await commitImport([file("alice__pritunl__main.ovpn", ovpn("for-bob"))], actor, "cli");
    expect(plan.items[0]).toMatchObject({ action: "replace", ownerChange: true });
    const versions = await db.select().from(schema.vpnConfigVersions).where(eq(schema.vpnConfigVersions.configId, id));
    expect(versions).toHaveLength(1);
    expect((await getOwnedActiveConfig(b.id, id))?.content.toString()).toContain("for-bob");
    expect(a).toBeTruthy();
  });

  it("admin: can't assign keys to themselves", async () => {
    const { setAlias } = await import("@/server/admin/users");
    const admin = await signUp("99999999-0000-4000-8000-000000000009", "admin@test.example");
    await signUp("bbbbbbbb-0000-4000-8000-000000000002", "bob@test.example");
    await commitImport([file("bob__pritunl__main.ovpn", ovpn("b")), file("newhire__pritunl__main.ovpn", ovpn("n"))], actor, "cli");
    expect(await setAlias({ keyType: "short_upn", keyValue: "bob", userId: admin.id, move: true, actorUserId: admin.id })).toMatchObject({ ok: false, error: "self_assign" });
    expect(await setAlias({ keyType: "short_upn", keyValue: "newhire", userId: admin.id, move: false, actorUserId: admin.id })).toMatchObject({ ok: false, error: "self_assign" });
    expect(await listConfigsForUser(admin.id)).toHaveLength(0);
  });

  it("admin: removing a key and linking it elsewhere doesn't expose the configs either", async () => {
    const { setAlias, removeAlias } = await import("@/server/admin/users");
    const admin = await signUp("99999999-0000-4000-8000-000000000009", "admin@test.example");
    const a = await signUp("aaaaaaaa-0000-4000-8000-000000000001", "alice@test.example");
    const b = await signUp("bbbbbbbb-0000-4000-8000-000000000002", "bob@test.example");
    await commitImport([file("alice__pritunl__main.ovpn", ovpn("a"))], actor, "cli");
    const [alias] = await db.select().from(schema.ownerAliases).where(eq(schema.ownerAliases.userId, a.id));
    await removeAlias(alias!.id);
    expect(await setAlias({ keyType: "short_upn", keyValue: "alice", userId: b.id, move: false, actorUserId: admin.id })).toMatchObject({ ok: true, claimed: 0, keptByPreviousOwner: 1 });
    expect(await listConfigsForUser(b.id)).toHaveLength(0);
  });

  it("admin: a quarantined file can't be re-routed to another owner or to the admin", async () => {
    const { resolveQuarantineItem } = await import("@/server/admin/quarantine");
    const admin = await signUp("99999999-0000-4000-8000-000000000009", "admin@test.example");
    await signUp("bbbbbbbb-0000-4000-8000-000000000002", "bob@test.example");
    const adminActor = { oid: admin.oid, upn: admin.upn };
    // Owner readable from the name (bad extension) → owner locked.
    await commitImport([file("bob__pritunl__main.txt", ovpn("b")), file("bob-backup.ovpn", ovpn("bk"))], actor, "cli");
    const rows = await db.select().from(schema.quarantineItems);
    const locked = rows.find((r) => r.originalFilename === "bob__pritunl__main.txt")!;
    const nameless = rows.find((r) => r.originalFilename === "bob-backup.ovpn")!;
    expect(await resolveQuarantineItem(locked.id, { ownerKey: "admin", type: "pritunl", label: "main" }, adminActor)).toMatchObject({ ok: false, error: "owner_locked" });
    expect(await resolveQuarantineItem(locked.id, { ownerKey: "bob", type: "pritunl", label: "main" }, adminActor)).toMatchObject({ ok: true });
    // Owner not readable → the admin may set it, but not to themselves.
    expect(await resolveQuarantineItem(nameless.id, { ownerKey: "admin", type: "pritunl", label: "x" }, adminActor)).toMatchObject({ ok: false, error: "self_assign" });
    expect(await listConfigsForUser(admin.id)).toHaveLength(0);
  });

  it("admin: revoking sessions signs the user out", async () => {
    const { revokeSessions } = await import("@/server/admin/users");
    const a = await signUp("aaaaaaaa-0000-4000-8000-000000000001", "alice@test.example");
    await db.insert(schema.session).values({ id: "s1", token: "t1", userId: a.id, expiresAt: new Date(Date.now() + 3_600_000) });
    expect(await revokeSessions(a.id)).toMatchObject({ count: 1, upn: "alice@test.example" });
    expect(await db.select().from(schema.session).where(eq(schema.session.userId, a.id))).toHaveLength(0);
  });

  it("admin: rollback, deactivate and delete (crypto-shred)", async () => {
    const { rollbackConfig, setConfigStatus, deleteConfig, getConfigDetail } = await import("@/server/admin/configs");
    const a = await signUp("aaaaaaaa-0000-4000-8000-000000000001", "alice@test.example");
    await commitImport([file("alice__pritunl__main.ovpn", ovpn("v1"))], actor, "cli");
    await commitImport([file("alice__pritunl__main.ovpn", ovpn("v2"))], actor, "cli");
    const id = await configId("alice", "pritunl", "main");
    const v1 = (await getConfigDetail(id))!.versions.find((v) => v.version === 1)!;
    expect(await rollbackConfig(id, v1.id)).toBe(1);
    expect((await getOwnedActiveConfig(a.id, id))?.content.toString()).toContain("v1");

    expect(await setConfigStatus(id, "deactivated")).toBe(true);
    expect(await getOwnedActiveConfig(a.id, id)).toBeNull();
    expect(await setConfigStatus(id, "active")).toBe(true);

    expect(await deleteConfig(id)).toBe(true);
    const detail = await getConfigDetail(id);
    expect(detail?.config.status).toBe("deleted");
    expect(detail?.versions).toHaveLength(0); // ciphertexts are gone
    expect(await setConfigStatus(id, "active")).toBe(false);
    // Importing the same owner/type/label again brings the config back as new.
    const again = await commitImport([file("alice__pritunl__main.ovpn", ovpn("v3"))], actor, "cli");
    expect(again.items[0]!.action).toBe("create");
    expect((await getOwnedActiveConfig(a.id, id))?.content.toString()).toContain("v3");
  });

  it("admin: a quarantined file is accepted under a corrected name", async () => {
    const { resolveQuarantineItem } = await import("@/server/admin/quarantine");
    const a = await signUp("aaaaaaaa-0000-4000-8000-000000000001", "alice@test.example");
    await commitImport([file("alice-backup.ovpn", ovpn("bk")), file("x__vless__y.txt", "nope")], actor, "cli");
    const rows = await db.select().from(schema.quarantineItems);
    const good = rows.find((r) => r.originalFilename === "alice-backup.ovpn")!;
    const bad = rows.find((r) => r.originalFilename === "x__vless__y.txt")!;

    expect(await resolveQuarantineItem(bad.id, { ownerKey: "x", type: "vless", label: "y" }, actor)).toMatchObject({ ok: false, reason: "vless_not_a_link" });
    expect(await resolveQuarantineItem(good.id, { ownerKey: "Alice", type: "pritunl", label: "backup" }, actor)).toMatchObject({ ok: true, action: "create" });
    expect((await listConfigsForUser(a.id)).map((c) => c.label)).toEqual(["backup"]);
    expect((await db.select().from(schema.quarantineItems)).map((r) => r.id)).toEqual([bad.id]);
  });

  it("the audit log rejects updates and deletes", async () => {
    await db.insert(schema.auditLog).values({ action: "sign_in", actorUpn: "x" });
    await expect(db.execute(sql`update audit_log set actor_upn = 'y'`)).rejects.toThrow();
    await expect(db.execute(sql`delete from audit_log`)).rejects.toThrow();
  });
  it("quarantines new profiles for a renamed employee's stale automatic alias", async () => {
    const oid = "aaaaaaaa-0000-4000-8000-000000000001";
    const old = await signUp(oid, "alice@test.example");
    await commitImport([file("alice__pritunl__old.ovpn", ovpn("old"))], actor, "cli");
    await signUp(oid, "alice.renamed@test.example");
    const newcomer = await signUp("bbbbbbbb-0000-4000-8000-000000000002", "alice@test.example");
    const result = await commitImport([file("alice__pritunl__new.ovpn", ovpn("new-person"))], actor, "cli");
    expect(result.items[0]).toMatchObject({ action: "quarantine", reason: "owner_ambiguous" });
    expect((await listConfigsForUser(old.id)).map((c) => c.label)).toEqual(["old"]);
    expect(await listConfigsForUser(newcomer.id)).toHaveLength(0);
  });

  it("blocks stale aliases even before the replacement employee signs in", async () => {
    const oid = "aaaaaaaa-0000-4000-8000-000000000001";
    await signUp(oid, "alice@test.example");
    await signUp(oid, "alice.renamed@test.example");
    const result = await analyzeImport([file("alice__pritunl__new.ovpn", ovpn("new-person"))]);
    expect(result.items[0]).toMatchObject({ action: "quarantine", reason: "owner_ambiguous" });
  });

  it("blocks collisions between domains and does not claim waiting configs", async () => {
    await commitImport([file("alice__pritunl__main.ovpn", ovpn("pending"))], actor, "cli");
    await upsertDirectoryUser({ oid: "aaaaaaaa-0000-4000-8000-000000000001", upn: "alice@first.example", name: "One", roles: ["Portal.User"], employeeId: null });
    const second = await signUp("bbbbbbbb-0000-4000-8000-000000000002", "alice@second.example");
    expect(await listConfigsForUser(second.id)).toHaveLength(0);
    const result = await analyzeImport([file("alice__pritunl__new.ovpn", ovpn("new"))]);
    expect(result.items[0]).toMatchObject({ action: "quarantine", reason: "owner_ambiguous" });
  });

  it("rolls back an entire import if its audit insert fails", async () => {
    await signUp("aaaaaaaa-0000-4000-8000-000000000001", "alice@test.example");
    await db.execute(sql`create function test_reject_audit() returns trigger language plpgsql as $$ begin raise exception 'test audit unavailable'; end; $$`);
    await db.execute(sql`create trigger test_reject_audit before insert on audit_log for each row execute function test_reject_audit()`);
    try {
      await expect(commitImport([file("alice__pritunl__main.ovpn", ovpn("a"))], actor, "cli")).rejects.toThrow();
      expect(await db.select().from(schema.vpnConfigs)).toHaveLength(0);
      expect(await db.select().from(schema.vpnConfigVersions)).toHaveLength(0);
    } finally {
      await db.execute(sql`drop trigger test_reject_audit on audit_log`);
      await db.execute(sql`drop function test_reject_audit()`);
    }
  });

  it("does not claim pending configs through ambiguous manual keys of different types", async () => {
    const { setAlias } = await import("@/server/admin/users");
    const admin = await signUp("99999999-0000-4000-8000-000000000009", "admin@test.example");
    const a = await signUp("aaaaaaaa-0000-4000-8000-000000000001", "alice@test.example");
    const b = await signUp("bbbbbbbb-0000-4000-8000-000000000002", "bob@test.example");
    await commitImport([file("shared__pritunl__main.ovpn", ovpn("waiting"))], actor, "cli");
    await setAlias({ keyType: "employee_code", keyValue: "shared", userId: a.id, move: false, actorUserId: admin.id });
    const result = await setAlias({ keyType: "short_upn", keyValue: "shared", userId: b.id, move: false, actorUserId: admin.id });
    expect(result).toMatchObject({ ok: true, claimed: 0 });
    expect(await listConfigsForUser(b.id)).toHaveLength(0);
  });

  it("keeps config mutations inside the caller's audit transaction", async () => {
    const { setConfigStatus, deleteConfig } = await import("@/server/admin/configs");
    await signUp("aaaaaaaa-0000-4000-8000-000000000001", "alice@test.example");
    await commitImport([file("alice__pritunl__main.ovpn", ovpn("a"))], actor, "cli");
    const id = await configId("alice", "pritunl", "main");
    for (const mutate of [(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => setConfigStatus(id, "deactivated", tx),
                          (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => deleteConfig(id, tx)]) {
      await expect(db.transaction(async (tx) => { await mutate(tx); throw new Error("audit failed"); })).rejects.toThrow("audit failed");
      expect((await db.select().from(schema.vpnConfigs))[0]!.status).toBe("active");
      expect(await db.select().from(schema.vpnConfigVersions)).toHaveLength(1);
    }
  });

});
