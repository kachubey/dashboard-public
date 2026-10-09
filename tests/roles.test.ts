import { describe, expect, it } from "vitest";
import { hasPortalAccess, isAdmin, normalizeRoles, shortUpnOf } from "@/server/auth/roles";

describe("roles", () => {
  it("keeps only known portal roles from the claim", () => {
    expect(normalizeRoles(["Portal.User", "Something.Else", "Portal.User"])).toEqual(["Portal.User"]);
    expect(normalizeRoles("Portal.Admin")).toEqual([]);
    expect(normalizeRoles(undefined)).toEqual([]);
  });

  it("grants access only with a portal role", () => {
    expect(hasPortalAccess([])).toBe(false);
    expect(hasPortalAccess(["Portal.User"])).toBe(true);
    expect(hasPortalAccess(["Portal.Admin"])).toBe(true);
    expect(isAdmin(["Portal.User"])).toBe(false);
  });

  it("derives shortUpn from the UPN", () => {
    expect(shortUpnOf("Alice.Anderson@Contoso.com")).toBe("alice.anderson");
  });
});
