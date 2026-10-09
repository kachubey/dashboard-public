import { describe, expect, it } from "vitest";
import { downloadFileName, parseFileName } from "@/server/vpn/filename";

describe("file name parser", () => {
  it("parses the convention, case-insensitively", () => {
    expect(parseFileName("Alice__Pritunl__Main.OVPN")).toEqual({
      ok: true,
      value: { ownerKey: "alice", type: "pritunl", label: "main", extension: ".ovpn" },
    });
    expect(parseFileName("alice__vless__nl-1.txt")).toMatchObject({ ok: true, value: { label: "nl-1" } });
    expect(parseFileName("E1042__wg__office-a.conf")).toMatchObject({ ok: true, value: { ownerKey: "e1042" } });
    expect(parseFileName("alice.anderson__pritunl__v1.2.ovpn")).toMatchObject({ ok: true, value: { ownerKey: "alice.anderson", label: "v1.2" } });
  });

  it("accepts a Pritunl .tar export", () => {
    expect(parseFileName("alice__pritunl__main.tar")).toMatchObject({ ok: true, value: { extension: ".tar" } });
  });

  it("ignores folders in the path", () => {
    expect(parseFileName("inbox/sub/alice__wg__a.conf")).toMatchObject({ ok: true });
    expect(parseFileName("C:\\drop\\alice__wg__a.conf")).toMatchObject({ ok: true });
  });

  it.each([
    ["alice-main.ovpn", "name_pattern"],
    ["alice__pritunl.ovpn", "name_pattern"],
    ["a__b__c__d.ovpn", "name_pattern"],
    ["noextension", "name_missing_extension"],
    ["alice__ipsec__main.conf", "name_unknown_type"],
    ["alice__wg__main.ovpn", "name_extension_mismatch"],
    ["alice__vless__nl-1.conf", "name_extension_mismatch"],
    ["iva nov__wg__a.conf", "name_bad_owner_key"],
    ["-alice__wg__a.conf", "name_bad_owner_key"],
    ["alice__wg__a!b.conf", "name_bad_label"],
    [`alice__wg__${"x".repeat(65)}.conf`, "name_bad_label"],
  ])("rejects %s (%s)", (name, reason) => {
    expect(parseFileName(name)).toMatchObject({ ok: false, reason });
  });

  it("builds the download file name", () => {
    expect(downloadFileName("pritunl", "main")).toBe("pritunl-main.ovpn");
    expect(downloadFileName("wg", "office-a")).toBe("wg-office-a.conf");
  });
});
