import type { Role } from "./roles";
import { defineRequestState } from "@better-auth/core/context";

// Identity data from the Entra ID token, handed from the provider's
// getUserInfo() to the database hooks of the same sign-in.
//
// Better Auth deliberately drops provider-profile values for fields marked
// `input: false` (oid, upn, roles…), so they can't travel with the user
// object. They are kept in Better Auth request state for the few
// milliseconds between the token exchange and the session being created,
// and written to the user row by the hooks in ./index.ts.

export interface EntraIdentity {
  oid: string;
  upn: string;
  shortUpn: string;
  name: string;
  roles: Role[];
  employeeId: string | null;
}

// Better Auth scopes this store to one callback, including concurrent logins
// for the same oid. A process-global map could mix their roles and claims.
const pending = defineRequestState<EntraIdentity | null>(() => null);

export async function parkIdentity(identity: EntraIdentity): Promise<void> {
  await pending.set(identity);
}

export async function peekIdentity(oid: string): Promise<EntraIdentity | null> {
  const hit = await pending.get();
  return hit?.oid === oid ? hit : null;
}

export async function takeIdentity(oid: string): Promise<EntraIdentity | null> {
  const identity = await peekIdentity(oid);
  await pending.set(null);
  return identity;
}

/** "<oid>@oid.invalid" → oid (see identityEmail in ./roles). */
export function oidFromIdentityEmail(email: string | null | undefined): string | null {
  const m = /^([0-9a-f-]{36})@oid\.invalid$/i.exec(email ?? "");
  return m ? m[1]!.toLowerCase() : null;
}
