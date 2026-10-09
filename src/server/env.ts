import { z } from "zod";

// Single source of truth for configuration. Imported by the app (via
// instrumentation, at startup) and by CLI scripts, so it must stay free of
// Next.js-only imports.

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url(),
    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    ENTRA_TENANT_ID: z.uuid().optional(),
    ENTRA_CLIENT_ID: z.uuid().optional(),
    ENTRA_CLIENT_SECRET: z.string().min(1).optional(),
    // Sovereign clouds (or tests) only; the default is the global cloud.
    ENTRA_AUTHORITY: z.url().default("https://login.microsoftonline.com"),
    // Comma-separated UPN suffixes allowed to sign in, e.g. "example.com".
    // Owner keys use the part before "@": production requires exactly one domain.
    ALLOWED_UPN_DOMAINS: z
      .string()
      .default("")
      .transform((v) => v.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean)),
    FEATURE_EMPLOYEE_ID: bool,
    SESSION_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(24).default(8),
    SUPPORT_URL: z.url().default("https://help.example.com"),
    APP_TIME_ZONE: z
      .string()
      .default("UTC")
      .refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", "Unknown IANA time zone"),
    AUTH_MOCK: z.string().optional(),
    // "id:base64key,id2:base64key" — 32-byte AES-256 keys. Old keys stay listed
    // until `npm run keys:rotate` has re-encrypted every row that uses them.
    CONFIG_ENC_KEYS: z.string().min(1, "CONFIG_ENC_KEYS is required"),
    CONFIG_ENC_ACTIVE_KEY_ID: z.string().regex(/^[a-z0-9-]{1,32}$/),
    // Owner keys matching this pattern are treated as employee codes (only
    // with FEATURE_EMPLOYEE_ID=true), everything else as shortUpn.
    EMPLOYEE_CODE_REGEX: z
      .string()
      .default("^[a-z]\\d{3,8}$")
      .refine((v) => {
        try {
          new RegExp(v);
          return true;
        } catch {
          return false;
        }
      }, "Invalid regular expression"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.ALLOWED_UPN_DOMAINS.length !== 1) {
      ctx.addIssue({ code: "custom", path: ["ALLOWED_UPN_DOMAINS"], message: "Short-UPN ownership requires exactly one allowed UPN domain in production" });
    }
    for (const field of ["BETTER_AUTH_URL", "ENTRA_AUTHORITY"] as const) {
      const url = new URL(env[field]);
      const localTest = env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if ((url.protocol !== "https:" && !(localTest && url.protocol === "http:")) ||
          url.username || url.password || url.search || url.hash || url.pathname !== "/") {
        ctx.addIssue({ code: "custom", path: [field], message: "Use an HTTPS origin without credentials, path, query or fragment (HTTP is allowed only on loopback outside production)" });
      }
    }
    const keys = parseKeyList(env.CONFIG_ENC_KEYS);
    if (typeof keys === "string") {
      ctx.addIssue({ code: "custom", path: ["CONFIG_ENC_KEYS"], message: keys });
    } else if (!keys.has(env.CONFIG_ENC_ACTIVE_KEY_ID)) {
      ctx.addIssue({
        code: "custom",
        path: ["CONFIG_ENC_ACTIVE_KEY_ID"],
        message: "CONFIG_ENC_ACTIVE_KEY_ID must be one of the ids in CONFIG_ENC_KEYS",
      });
    }
    if (env.NODE_ENV === "production" && env.AUTH_MOCK !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_MOCK"],
        message: "AUTH_MOCK must not be set in production (remove the variable entirely)",
      });
    }
    const entra = [env.ENTRA_TENANT_ID, env.ENTRA_CLIENT_ID, env.ENTRA_CLIENT_SECRET];
    const entraSet = entra.filter(Boolean).length;
    if (entraSet !== 0 && entraSet !== 3) {
      ctx.addIssue({
        code: "custom",
        path: ["ENTRA_CLIENT_ID"],
        message: "Set all of ENTRA_TENANT_ID, ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET, or none",
      });
    }
    const mock = env.NODE_ENV === "development" && env.AUTH_MOCK === "true";
    if (entraSet === 0 && !mock) {
      ctx.addIssue({
        code: "custom",
        path: ["ENTRA_CLIENT_ID"],
        message: "No sign-in method configured: set the ENTRA_* variables (or AUTH_MOCK=true in development)",
      });
    }
  })
  .transform((env) => ({
    ...env,
    authMockEnabled: env.NODE_ENV === "development" && env.AUTH_MOCK === "true",
    entraEnabled: Boolean(env.ENTRA_TENANT_ID && env.ENTRA_CLIENT_ID && env.ENTRA_CLIENT_SECRET),
    isProduction: env.NODE_ENV === "production",
    encryptionKeys: parseKeyList(env.CONFIG_ENC_KEYS) as Map<string, Buffer>,
  }));

export type Env = z.infer<typeof schema>;

/** Parses CONFIG_ENC_KEYS into id → 32-byte key, or returns an error message. */
export function parseKeyList(value: string): Map<string, Buffer> | string {
  const keys = new Map<string, Buffer>();
  for (const entry of value.split(",").map((s) => s.trim()).filter(Boolean)) {
    const sep = entry.indexOf(":");
    const id = entry.slice(0, sep);
    if (sep < 1 || !/^[a-z0-9-]{1,32}$/.test(id)) {
      // Never echo the entry itself: it may contain key material.
      return "CONFIG_ENC_KEYS: every entry must look like <id>:<base64> (id: a-z, 0-9, -)";
    }
    const key = Buffer.from(entry.slice(sep + 1), "base64");
    if (key.length !== 32) return `CONFIG_ENC_KEYS: key "${id}" must decode to 32 bytes`;
    if (keys.has(id)) return `CONFIG_ENC_KEYS: duplicate key id "${id}"`;
    keys.set(id, key);
  }
  return keys.size ? keys : "CONFIG_ENC_KEYS has no keys";
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  // `KEY=` in an env file means "not set", not "empty string".
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ""),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "env"}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
