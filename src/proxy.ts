import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Runs before every page request:
//  1. builds a per-request nonce and a strict Content-Security-Policy;
//  2. sends visitors without a session cookie to /signin. This is only an
//     optimistic check — real authorization happens in the Data Access Layer
//     (src/server/auth/session.ts) on every page, action and route handler.

const PUBLIC_PATHS = ["/signin", "/denied"];

function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets nonce'd Next.js bootstrap scripts load their chunks.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are needed by UI primitives (positioning, animations).
    // Style injection is far less dangerous than script injection, which stays strict.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    // Sign-in posts to our own action, which then redirects to login.microsoftonline.com.
    "form-action 'self' https://login.microsoftonline.com",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!isPublic && !getSessionCookie(request, { cookiePrefix: "portal" })) {
    return NextResponse.redirect(new URL("/signin", request.url));
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Everything except auth API, other API routes (they authorize themselves
      // and return JSON/files, not HTML) and static assets.
      source: "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
