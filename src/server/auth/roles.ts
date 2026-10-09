// App Roles defined on the Entra app registration (docs/ENTRA_SETUP.md).
// The `value` of each role must match these strings exactly.
export const ROLES = {
  user: "Portal.User",
  admin: "Portal.Admin",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

const KNOWN = new Set<string>(Object.values(ROLES));

/** Keep only roles this portal understands; ignore anything else in the claim. */
export function normalizeRoles(claim: unknown): Role[] {
  if (!Array.isArray(claim)) return [];
  return [...new Set(claim.filter((r): r is Role => typeof r === "string" && KNOWN.has(r)))];
}

export function hasPortalAccess(roles: readonly string[]): boolean {
  return roles.includes(ROLES.user) || roles.includes(ROLES.admin);
}

export function isAdmin(roles: readonly string[]): boolean {
  return roles.includes(ROLES.admin);
}

/** "Alice.Anderson@Contoso.com" → "alice.anderson" */
export function shortUpnOf(upn: string): string {
  return upn.split("@")[0]!.trim().toLowerCase();
}

/**
 * Better Auth requires a unique e-mail per user. The UPN can't be that key:
 * UPNs get reused (a new employee receives a departed colleague's address),
 * which would block the newcomer's sign-in. The immutable object ID is
 * unique forever, so the internal e-mail is derived from it. ".invalid" is a
 * reserved TLD — nothing is ever sent there (all e-mail features are off).
 */
export function identityEmail(oid: string): string {
  return `${oid.toLowerCase()}@oid.invalid`;
}
