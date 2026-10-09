import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";
import { env } from "../env";
import { findMockUser } from "./mock-users";
import { upsertDirectoryUser } from "./users";

/**
 * Development-only sign-in as one of the MOCK_USERS. The plugin is registered
 * only when mock auth is enabled, and the endpoint re-checks the flag on every
 * call so it can never serve a session in production.
 */
export const mockSignIn = () =>
  ({
    id: "mock-sign-in",
    endpoints: {
      mockSignIn: createAuthEndpoint(
        "/dev/mock-sign-in",
        { method: "POST", body: z.object({ oid: z.uuid() }) },
        async (ctx) => {
          if (!env().authMockEnabled) {
            throw new APIError("NOT_FOUND");
          }
          // Login-CSRF guard: only our own pages may start a mock session.
          const origin = (ctx.headers ?? ctx.request?.headers)?.get("origin");
          if (origin !== new URL(env().BETTER_AUTH_URL).origin) {
            throw new APIError("FORBIDDEN", { message: "Invalid origin" });
          }
          const mock = findMockUser(ctx.body.oid);
          if (!mock) {
            throw new APIError("BAD_REQUEST", { message: "Unknown mock user" });
          }
          // Same path as a real Entra sign-in: refresh the directory fields and roles.
          const user = await upsertDirectoryUser({
            oid: mock.oid,
            upn: mock.upn,
            name: mock.name,
            roles: mock.roles,
            employeeId: mock.employeeId ?? null,
          });
          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session) {
            // Rejected by the session hook (no portal role).
            return ctx.json({ ok: false, reason: "access_denied" as const });
          }
          const fullUser = await ctx.context.internalAdapter.findUserById(user.id);
          await setSessionCookie(ctx, { session, user: fullUser! });
          return ctx.json({ ok: true as const });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
