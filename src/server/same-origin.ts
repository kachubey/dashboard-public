import { env } from "./env";

/**
 * CSRF guard for route handlers that change state. Browsers always send
 * Origin on cross-site POSTs; requests from other sites (or without Origin)
 * are refused. Session cookies are SameSite=Lax as a second layer.
 */
export function isSameOrigin(request: Request): boolean {
  return request.headers.get("origin") === new URL(env().BETTER_AUTH_URL).origin;
}
