import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { isIP } from "node:net";
import { env } from "../env";
import { rateLimit } from "../rate-limit";

export function entraTokenVerifier(authority: string, tenant: string, clientId: string, key?: JWTVerifyGetKey) {
  const base = authority.replace(/\/+$/, "");
  const jwks = key ?? createRemoteJWKSet(new URL(`${base}/${tenant}/discovery/v2.0/keys`), {
    timeoutDuration: 5000,
    cooldownDuration: 30_000,
  });
  return async (token: string, nonce: string | undefined) => {
    if (!nonce) throw new Error("Missing OIDC nonce");
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ["RS256"],
      issuer: `${base}/${tenant}/v2.0`,
      audience: clientId,
      requiredClaims: ["sub", "iss", "aud", "exp", "iat", "tid", "oid", "nonce"],
      maxTokenAge: "1h",
      clockTolerance: 5,
    });
    if (payload.tid !== tenant || payload.nonce !== nonce ||
        (payload.azp !== undefined && payload.azp !== clientId) ||
        (Array.isArray(payload.aud) && (payload.aud.length !== 1 || payload.aud[0] !== clientId))) {
      throw new Error("Invalid OIDC claims");
    }
    return payload;
  };
}

/** Protect both the HTTP endpoint and Server Action calls through auth.api. */
export function entraSecurity(): BetterAuthPlugin {
  const e = env();
  return {
    id: "portal-entra-security",
    init(ctx) {
      const provider = ctx.socialProviders.find((p) => p.id === "microsoft");
      if (!provider) return;
      const verify = entraTokenVerifier(e.ENTRA_AUTHORITY, e.ENTRA_TENANT_ID!, e.ENTRA_CLIENT_ID!);
      const authorize = provider.createAuthorizationURL.bind(provider);
      const getUserInfo = provider.getUserInfo.bind(provider);
      // Better Auth generates and stores this nonce alongside state and PKCE.
      provider.requiresIdTokenNonce = true;
      provider.createAuthorizationURL = async (data) => {
        if (!data.idTokenNonce) throw new Error("Missing OIDC nonce");
        const url = await authorize(data);
        url.searchParams.set("nonce", data.idTokenNonce);
        return url;
      };
      provider.getUserInfo = async (token) => {
        try {
          if (!token.idToken) return null;
          await verify(token.idToken, token.expectedIdTokenNonce);
        } catch {
          return null;
        }
        return getUserInfo(token);
      };
    },
    hooks: {
      before: [{
        matcher: (ctx) => ctx.path === "/sign-in/social",
        handler: createAuthMiddleware(async (ctx) => {
          const headers = ctx.headers ?? ctx.request?.headers;
          // Also protect first sign-in, before the browser has any cookies.
          if (headers?.get("origin") !== new URL(e.BETTER_AUTH_URL).origin) {
            throw new APIError("FORBIDDEN", { message: "Invalid origin" });
          }
          const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
          // Caddy overwrites X-Forwarded-For; never expose the app port directly.
          const ip = forwarded && isIP(forwarded) ? forwarded : "unknown";
          const local = await rateLimit(`signin:${ip}`, 20, 60);
          const global = local.ok ? await rateLimit("signin:global", 200, 60) : local;
          if (!local.ok || !global.ok) {
            ctx.setHeader("Retry-After", String(Math.max(local.retryAfter, global.retryAfter)));
            throw new APIError("TOO_MANY_REQUESTS", { message: "Too many sign-in attempts" });
          }
        }),
      }],
    },
  };
}
