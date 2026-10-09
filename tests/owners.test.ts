import { describe, expect, it } from "vitest";
import { resolveOwner, type AliasRow } from "@/server/vpn/owners";

const opts = { employeeCodes: true, employeeCodePattern: /^[a-z]\d{3,8}$/i };
const aliases: AliasRow[] = [
  { keyType: "short_upn", keyValue: "alice", userId: "u-alice" },
  { keyType: "employee_code", keyValue: "e1042", userId: "u-alice" },
  { keyType: "short_upn", keyValue: "e2000", userId: "u-a" },
  { keyType: "employee_code", keyValue: "e2000", userId: "u-b" },
];

describe("owner resolution", () => {
  it("matches a shortUpn alias", () => {
    expect(resolveOwner("alice", aliases, opts)).toEqual({ status: "matched", keyType: "short_upn", userId: "u-alice" });
  });

  it("matches an employee-code alias", () => {
    expect(resolveOwner("e1042", aliases, opts)).toEqual({ status: "matched", keyType: "employee_code", userId: "u-alice" });
  });

  it("is pending when nobody with that key has signed in yet", () => {
    expect(resolveOwner("newhire", aliases, opts)).toEqual({ status: "pending", keyType: "short_upn" });
    expect(resolveOwner("e9999", aliases, opts)).toEqual({ status: "pending", keyType: "employee_code" });
  });

  it("treats employee-code-looking keys as shortUpn when the feature is off", () => {
    expect(resolveOwner("e9999", aliases, { ...opts, employeeCodes: false })).toEqual({ status: "pending", keyType: "short_upn" });
  });

  it("is ambiguous when two kinds of alias point at different people", () => {
    expect(resolveOwner("e2000", aliases, opts)).toEqual({ status: "ambiguous" });
  });

  it("does not resolve an old alias or a known directory collision", () => {
    expect(resolveOwner("alice", [{ ...aliases[0]!, blocked: true }], opts)).toEqual({ status: "ambiguous" });
  });
});
