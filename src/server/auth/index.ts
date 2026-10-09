import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { and, eq, sql } from "drizzle-orm";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import type { MicrosoftEntraIDProfile } from "better-auth/social-providers";
import { decodeJwt } from "jose";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";
import { audit } from "../audit";
import { db, schema } from "../db";
import { env } from "../env";
import { mockSignIn } from "./mock-plugin";
import { entraSecurity } from "./entra-security";
import { hasPortalAccess, identityEmail, normalizeRoles, shortUpnOf } from "./roles";
import { linkAliasesOnSignIn } from "../vpn/owners";
import { findUserById } from "./users";
import { oidFromIdentityEmail, parkIdentity, peekIdentity, takeIdentity, type EntraIdentity } from "./identity";

// Endpoints Better Auth ships that this portal never uses. Disabling them
// shrinks the attack surface: no client-side profile edits, no handing OAuth
// tokens to the browser, no account linking, no password flows.
const DISABLED_PATHS = [
  "/account-info",
  "/change-email",
  "/change-password",
  "/delete-user",
  "/delete-user/callback",
  // The app reads sessions server-side only; the HTTP endpoint would hand the
  // session token to any script running in the page.
  "/get-session",
  // Session listing/revocation by end users isn't offered; admins revoke
  // sessions from the admin UI (server-side).
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/get-access-token",
  "/link-social",
  "/list-accounts",
  "/refresh-token",
  "/request-password-reset",
  "/reset-password",
  "/send-verification-email",
  "/sign-in/email",
  "/sign-up/email",
  "/unlink-account",
  "/update-session",
  "/update-user",
  "/verify-email",
  "/verify-password",
];

const NO_TOKENS = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
};

function identityColumns(identity: EntraIdentity) {
  return {
    oid: identity.oid,
    upn: identity.upn,
    shortUpn: identity.shortUpn,
    name: identity.name,
    roles: identity.roles,
    employeeId: identity.employeeId,
  };
}

/** With ALLOWED_UPN_DOMAINS set, only those UPN suffixes may sign in. */
export function upnDomainAllowed(upn: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  return allowed.includes(upn.slice(upn.lastIndexOf("@") + 1).toLowerCase());
}

async function fetchEmployeeId(accessToken: string | undefined): Promise<string | null> {
  if (!accessToken) return null;
  try {
    const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=employeeId", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { employeeId?: string | null };
    return body.employeeId?.trim() || null;
  } catch {
    // Sign-in must not fail because Graph is slow; the field just stays empty.
    return null;
  }
}

function createAuth() {
  const e = env();
  const plugins: BetterAuthPlugin[] = [];
  if (e.entraEnabled) plugins.push(entraSecurity());
  if (e.authMockEnabled) plugins.push(mockSignIn());
  // nextCookies must be last so it can apply cookies set by earlier plugins.
  plugins.push(nextCookies());

  return betterAuth({
    appName: "Employee Portal",
    baseURL: e.BETTER_AUTH_URL,
    secret: e.BETTER_AUTH_SECRET,
    trustedOrigins: [e.BETTER_AUTH_URL],
    telemetry: { enabled: false },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    disabledPaths: DISABLED_PATHS,
    user: {
      // `input: false` — none of these can be set through any client-facing endpoint.
      additionalFields: {
        // Not "required" for Better Auth (it validates before our hooks run);
        // the user.create hook always sets them and the columns are NOT NULL.
        oid: { type: "string", required: false, input: false },
        upn: { type: "string", required: false, input: false },
        shortUpn: { type: "string", required: false, input: false },
        employeeId: { type: "string", required: false, input: false },
        roles: { type: "string[]", required: false, input: false, defaultValue: [] },
        locale: { type: "string", required: false, input: false },
        lastSignInAt: { type: "date", required: false, input: false },
      },
    },
    session: {
      expiresIn: e.SESSION_MAX_AGE_HOURS * 60 * 60,
      // Absolute lifetime: a session is never extended, so roles are re-read
      // from Entra at least every SESSION_MAX_AGE_HOURS.
      disableSessionRefresh: true,
    },
    account: {
      // Tokens are discarded by the account hooks below; encryption stays on
      // as a second line in case a future change starts keeping them.
      encryptOAuthTokens: true,
      accountLinking: { enabled: false },
    },
    advanced: {
      cookiePrefix: "portal",
      useSecureCookies: e.isProduction,
    },
    socialProviders: e.entraEnabled
      ? {
          microsoft: {
            clientId: e.ENTRA_CLIENT_ID!,
            clientSecret: e.ENTRA_CLIENT_SECRET!,
            tenantId: e.ENTRA_TENANT_ID!,
            authority: e.ENTRA_AUTHORITY,
            prompt: "select_account",
            // No offline_access: the portal never calls Graph after sign-in,
            // so no refresh token is requested or stored.
            disableDefaultScope: true,
            scope: ["openid", "profile", "email", ...(e.FEATURE_EMPLOYEE_ID ? ["User.Read"] : [])],
            // Sign-in only through the authorization code flow; a bare ID token
            // posted to /sign-in/social is not accepted.
            disableIdTokenSignIn: true,
            async getUserInfo(token) {
              if (!token.idToken) return null;
              // entraSecurity verifies signature, issuer, tenant, audience,
              // lifetime and the flow-bound nonce before invoking this hook.
              const claims = decodeJwt(token.idToken) as MicrosoftEntraIDProfile;
              const oid = typeof claims.oid === "string" ? claims.oid.toLowerCase() : "";
              // preferred_username is display data, not a directory owner key.
              const upn = typeof claims.upn === "string" ? claims.upn.toLowerCase() : "";
              if (!/^[0-9a-f-]{36}$/.test(oid) || !upn.includes("@")) return null;
              const name = typeof claims.name === "string" && claims.name ? claims.name : upn;
              await parkIdentity({
                oid,
                upn,
                shortUpn: shortUpnOf(upn),
                name,
                roles: normalizeRoles(claims.roles),
                employeeId: e.FEATURE_EMPLOYEE_ID ? await fetchEmployeeId(token.accessToken) : null,
              });
              return {
                user: { name, email: identityEmail(oid), emailVerified: true },
                data: { ...claims, oid },
              };
            },
          },
        }
      : {},
    databaseHooks: {
      user: {
        create: {
          // New Entra user: fill the identity columns from the parked ID-token
          // claims. Without them (no oid) no user row is created at all.
          before: async (user) => {
            const identity = await peekIdentity(oidFromIdentityEmail(user.email) ?? "");
            if (!identity) return false;
            return { data: { ...user, ...identityColumns(identity) } };
          },
        },
      },
      account: {
        // The portal never uses provider tokens after sign-in, so none are
        // stored (a stored ID token could be replayed from a database copy).
        create: { before: async (account) => ({ data: { ...account, ...NO_TOKENS } }) },
        update: { before: async (account) => ({ data: { ...account, ...NO_TOKENS } }) },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            const meta = { ip: session.ipAddress ?? null, userAgent: session.userAgent ?? null };
            const deny = async (reason: string, u?: { oid: string | null; upn: string | null }) => {
              await audit({ actor: { oid: u?.oid ?? null, upn: u?.upn ?? null }, action: "access_denied", meta, details: { reason } });
              return false as const;
            };

            // Entra sign-in: refresh name, UPN and roles from this sign-in's ID
            // token before the role gate. Fail closed if they are missing.
            if (ctx?.path?.startsWith("/callback/")) {
              const [acc] = await db
                .select({ accountId: schema.account.accountId })
                .from(schema.account)
                .where(and(eq(schema.account.userId, session.userId), eq(schema.account.providerId, "microsoft")))
                .limit(1);
              const identity = acc ? await takeIdentity(acc.accountId) : null;
              if (!identity) return deny("identity_claims_missing");
              if (!upnDomainAllowed(identity.upn, e.ALLOWED_UPN_DOMAINS)) {
                return deny("upn_domain_not_allowed", identity);
              }
              await db.transaction(async (tx) => {
                await tx.execute(sql`select pg_advisory_xact_lock(hashtext('vpn-config-import'))`);
                await tx.update(schema.user).set(identityColumns(identity)).where(eq(schema.user.id, session.userId));
              });
            }

            // Gate: a user without Portal.User / Portal.Admin never gets a session.
            const u = await findUserById(session.userId);
            if (!u || !hasPortalAccess(u.roles)) return deny("no_portal_role", u);
          },
          after: async (session, ctx) => {
            const now = new Date();
            const [u] = await db
              .update(schema.user)
              .set({ lastSignInAt: now })
              .where(eq(schema.user.id, session.userId))
              .returning();
            // Restore the language the user chose on another device.
            if (u?.locale && isLocale(u.locale)) {
              ctx?.setCookie(LOCALE_COOKIE, u.locale, {
                path: "/",
                sameSite: "lax",
                httpOnly: true,
                secure: e.isProduction,
                maxAge: 60 * 60 * 24 * 365,
              });
            }
            // Link the person's owner keys so configs imported before their
            // first sign-in become visible now.
            const aliasConflicts = u ? await linkAliasesOnSignIn(u) : [];
            await audit({
              actor: { oid: u?.oid ?? null, upn: u?.upn ?? null },
              action: "sign_in",
              meta: { ip: session.ipAddress ?? null, userAgent: session.userAgent ?? null },
              details: {
                roles: u?.roles ?? [],
                method: ctx?.path === "/dev/mock-sign-in" ? "mock" : "entra",
                ...(aliasConflicts.length ? { aliasConflicts } : {}),
              },
            });
          },
        },
      },
    },
    plugins,
  });
}

type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/** Lazily created so `next build` doesn't need runtime secrets. */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
