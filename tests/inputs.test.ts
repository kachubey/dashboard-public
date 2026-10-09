import { pack } from "tar-stream";
import { describe, expect, it } from "vitest";
import { expandInputs } from "@/server/vpn/import/inputs";

const f = (name: string, content: string | Buffer) => ({ name, bytes: Buffer.isBuffer(content) ? content : Buffer.from(content) });

async function tarOf(entries: Record<string, string>): Promise<Buffer> {
  const p = pack();
  for (const [name, body] of Object.entries(entries)) p.entry({ name }, body);
  p.finalize();
  const chunks: Buffer[] = [];
  for await (const c of p) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

// Same layout as a real Pritunl export: a multi-line JSON header in comments.
const pritunlOvpn = (user: string, server: string, org = "ExampleOrg") =>
  [
    "#{",
    '# "version": 1,',
    `# "user": ${JSON.stringify(user)},`,
    `# "organization": ${JSON.stringify(org)},`,
    `# "server": ${JSON.stringify(server)},`,
    '# "sync_token": "SAMPLE",',
    '# "sync_secret": "SAMPLE"',
    "#}",
    "setenv UV_NAME sample-1",
    "client",
    "remote 192.0.2.1 17911 udp",
    "<key>",
    "SAMPLE",
    "</key>",
    "",
  ].join("\n");

describe("Pritunl downloads (not renamed)", () => {
  it("takes owner and label from the profile header of <user>.tar", async () => {
    const tar = await tarOf({ "ExampleOrg_employee_office-main-vpn.ovpn": pritunlOvpn("employee", "office-main-vpn") });
    const [c, ...rest] = await expandInputs([f("employee.tar", tar)]);
    expect(rest).toHaveLength(0);
    expect(c).toMatchObject({
      source: "employee.tar › ExampleOrg_employee_office-main-vpn.ovpn",
      originalFilename: "ExampleOrg_employee_office-main-vpn.ovpn",
      parsed: { ownerKey: "employee", type: "pritunl", label: "office-main-vpn", extension: ".ovpn" },
    });
    expect(c!.raw.toString()).toContain("remote 192.0.2.1");
  });

  it("gives each server in a multi-server .tar its own label, whatever the archive is called", async () => {
    const tar = await tarOf({
      "My_Org_alice_nl_main.ovpn": pritunlOvpn("Alice", "NL main", "My_Org"),
      "My_Org_alice_de.ovpn": pritunlOvpn("alice@example.com", "de"),
    });
    const out = await expandInputs([f("alice (1).tar", tar)]);
    expect(out.map((c) => [c.parsed?.ownerKey, c.parsed?.label])).toEqual([
      ["alice", "nl-main"],
      ["alice", "de"],
    ]);
  });

  it("accepts a single .ovpn taken out of the archive", async () => {
    const [c] = await expandInputs([f("ExampleOrg_bob_office-main-vpn.ovpn", pritunlOvpn("bob", "office-main-vpn"))]);
    expect(c).toMatchObject({ parsed: { ownerKey: "bob", label: "office-main-vpn" } });
  });

  it("quarantines an .ovpn without a Pritunl header, keeping the owner editable", async () => {
    const [c] = await expandInputs([f("Alice main.ovpn", "client\nremote a 1\n")]);
    expect(c).toMatchObject({ parsed: null, error: "pritunl_no_header", partial: { type: "pritunl" } });
    expect(c!.partial?.ownerKey).toBeUndefined();
  });

  it("rejects a header user that can't be an owner key", async () => {
    const tar = await tarOf({ "o_x_s.ovpn": pritunlOvpn("bad name!", "s") });
    const [c] = await expandInputs([f("x.tar", tar)]);
    expect(c).toMatchObject({ parsed: null, error: "name_bad_owner_key", partial: { label: "s" } });
  });

  it("keeps the <owner>__pritunl__<label> convention for renamed files", async () => {
    const [c] = await expandInputs([f("smith__pritunl__main.ovpn", pritunlOvpn("Smith@example.com", "srv"))]);
    expect(c).toMatchObject({ parsed: { ownerKey: "smith", label: "main" } });
  });

  it("quarantines a renamed profile whose header names someone else", async () => {
    const tar = await tarOf({ "o_alice_s.ovpn": pritunlOvpn("alice", "s") });
    const csv = ["ownerKey,type,label,content_or_filename", "bob,pritunl,main,p.ovpn"].join("\n");
    const out = await expandInputs([
      f("smith__pritunl__main.ovpn", pritunlOvpn("alice", "srv")),
      f("smith__pritunl__vpn.tar", tar),
      f("m.csv", csv),
      f("p.ovpn", pritunlOvpn("alice", "srv")),
    ]);
    expect(out.map((c) => c.error)).toEqual(["pritunl_owner_mismatch", "pritunl_owner_mismatch", "pritunl_owner_mismatch"]);
    expect(out[1]).toMatchObject({ partial: { ownerKey: "smith" } });
  });
});

describe("import inputs", () => {
  it("extracts a single .ovpn from a Pritunl .tar under the outer label", async () => {
    const tar = await tarOf({ "org_alice_srv.ovpn": "client\nremote a 1\n", "readme.txt": "x" });
    const [c] = await expandInputs([f("alice__pritunl__main.tar", tar)]);
    expect(c).toMatchObject({ parsed: { ownerKey: "alice", label: "main", extension: ".ovpn" } });
    expect(c!.raw.toString()).toContain("remote a 1");
  });

  it("gives each .ovpn in a multi-server .tar its own label", async () => {
    const tar = await tarOf({ "a/Org_Alice_NL.ovpn": "client\nremote a 1\n", "a/Org_Alice_DE.ovpn": "client\nremote b 1\n" });
    const out = await expandInputs([f("alice__pritunl__main.tar", tar)]);
    expect(out.map((c) => c.parsed?.label).sort()).toEqual(["main-org_alice_de", "main-org_alice_nl"].map((l) => l.replace(/_/g, "-")));
  });

  it("flags a .tar without .ovpn", async () => {
    const [c] = await expandInputs([f("alice__pritunl__main.tar", await tarOf({ "x.txt": "x" }))]);
    expect(c).toMatchObject({ parsed: null, error: "tar_no_ovpn" });
  });

  it("reads a CSV manifest with inline links and file references", async () => {
    const csv = [
      "ownerKey,type,label,content_or_filename",
      "Alice,vless,nl-1,vless://11111111-2222-4333-8444-555555555555@h:443#x",
      "bob,wg,lab,legacy.conf",
      "smith,wg,lab,missing.conf",
    ].join("\n");
    const out = await expandInputs([f("batch.csv", csv), f("legacy.conf", "[Interface]\nPrivateKey = a\n[Peer]\n")]);
    expect(out).toHaveLength(3); // legacy.conf is consumed by the manifest, not imported on its own
    expect(out[0]).toMatchObject({ source: "batch.csv:2", parsed: { ownerKey: "alice", type: "vless", label: "nl-1" }, viaManifest: true });
    expect(out[1]).toMatchObject({ parsed: { ownerKey: "bob", type: "wg" } });
    expect(out[2]).toMatchObject({ parsed: null, error: "manifest_file_not_found" });
  });

  it("lets a manifest use each file once and keeps no bytes for rejected rows", async () => {
    const csv = ["ownerKey,type,label,content_or_filename", "a,wg,one,x.conf", "b,wg,two,x.conf", "c,wg,three,x.conf"].join("\n");
    const out = await expandInputs([f("m.csv", csv), f("x.conf", "[Interface]\nPrivateKey = a\n[Peer]\n")]);
    expect(out.map((c) => c.error ?? "ok")).toEqual(["ok", "manifest_file_reused", "manifest_file_reused"]);
    expect(out.slice(1).every((c) => c.raw.length === 0)).toBe(true);
  });

  it("refuses empty and oversized batches", async () => {
    await expect(expandInputs([])).rejects.toThrow("no_files");
    await expect(expandInputs(Array.from({ length: 501 }, (_, i) => f(`${i}.txt`, "x")))).rejects.toThrow("too_many_files");
  });
});
