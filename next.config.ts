import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const isProd = process.env.NODE_ENV === "production";

// Refuse to build a production bundle while mock auth is configured. The same
// rule is enforced at runtime by src/instrumentation.ts.
if (isProd && process.env.AUTH_MOCK !== undefined && process.env.AUTH_MOCK !== "") {
  throw new Error("AUTH_MOCK must not be set for a production build");
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  allowedDevOrigins: !isProd && process.env.AUTH_MOCK === "true" && process.env.BETTER_AUTH_URL
    ? [new URL(process.env.BETTER_AUTH_URL).hostname]
    : undefined,
  output: "standalone",
  poweredByHeader: false,
  // Every page here is per-user and some carry secrets, so nothing is cached
  // or prerendered with user data: Cache Components stays off.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
