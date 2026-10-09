import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from ".";
import { hasPortalAccess, isAdmin } from "./roles";

/**
 * Data Access Layer for the current user. Every page, Server Action and Route
 * Handler resolves the user through here — never from client-supplied ids.
 */
export interface SessionUser {
  id: string;
  oid: string;
  upn: string;
  shortUpn: string;
  name: string;
  roles: string[];
  locale: string | null;
  isAdmin: boolean;
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const result = await getAuth().api.getSession({ headers: await headers() });
  if (!result?.user) return null;
  const u = result.user;
  // Rows without directory identity can't exist (the create hook refuses
  // them); treat one as signed out rather than guessing.
  if (!u.oid || !u.upn || !u.shortUpn) return null;
  const roles = u.roles ?? [];
  return {
    id: u.id,
    oid: u.oid,
    upn: u.upn,
    shortUpn: u.shortUpn,
    name: u.name || u.upn,
    roles,
    locale: u.locale ?? null,
    isAdmin: isAdmin(roles),
  };
});

/** Signed in with a portal role, or redirected away. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (!hasPortalAccess(user.roles)) redirect("/denied");
  return user;
}

/** Portal.Admin only. Others get a 404 so admin routes aren't advertised. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  return user;
}
