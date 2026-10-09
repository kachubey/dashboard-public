import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  customType,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

// ---------------------------------------------------------------------------
// Better Auth core tables. Property names are the field names Better Auth
// expects; extra `user` columns are declared in `user.additionalFields`
// (src/server/auth/index.ts) and must stay in sync with this file.
// ---------------------------------------------------------------------------

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  // Immutable Entra object ID — the only identifier used for ownership.
  oid: text("oid").notNull().unique(),
  upn: text("upn").notNull(),
  // Lowercased part of the UPN before "@"; default owner key for configs.
  shortUpn: text("short_upn").notNull(),
  employeeId: text("employee_id"),
  // App Roles from the `roles` claim, refreshed on every sign-in.
  roles: text("roles").array().notNull().default(sql`'{}'::text[]`),
  locale: text("locale"),
  lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
  ...timestamps,
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [
    index("account_user_id_idx").on(t.userId),
    uniqueIndex("account_provider_account_uq").on(t.providerId, t.accountId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Audit log — append-only. UPDATE/DELETE are rejected by a trigger created in
// the migration (see drizzle/*_audit_append_only.sql).
// ---------------------------------------------------------------------------

export const auditAction = pgEnum("audit_action", [
  "sign_in",
  "sign_out",
  "access_denied",
  "config_download",
  "config_reveal",
  "import_commit",
  "config_replace",
  "config_deactivate",
  "config_reactivate",
  "config_rollback",
  "config_delete",
  "alias_update",
  "quarantine_resolve",
  "quarantine_delete",
  "audit_export",
  "sessions_revoke",
]);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorOid: text("actor_oid"),
    actorUpn: text("actor_upn"),
    action: auditAction("action").notNull(),
    targetConfigId: text("target_config_id"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    // Free-form context. Never put config contents or secrets here.
    details: jsonb("details").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("audit_log_at_idx").on(t.at),
    index("audit_log_actor_idx").on(t.actorOid),
    index("audit_log_action_idx").on(t.action),
  ],
);

// ---------------------------------------------------------------------------
// VPN configs
//
// A config is owned by an *owner key* (shortUpn or employee code), not by a
// user row. `owner_aliases` maps keys to users, so configs can be imported
// before the person ever signs in, and a renamed UPN is fixed by editing one
// alias instead of re-importing files.
// ---------------------------------------------------------------------------

export const ownerKeyType = pgEnum("owner_key_type", ["short_upn", "employee_code"]);
export const aliasSource = pgEnum("alias_source", ["auto", "manual"]);
export const configStatus = pgEnum("config_status", ["active", "deactivated", "deleted"]);
export const importSource = pgEnum("import_source", ["upload", "cli", "manifest", "provider", "seed"]);

export const ownerAliases = pgTable(
  "owner_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keyType: ownerKeyType("key_type").notNull(),
    // Normalized: trimmed, lowercased.
    keyValue: text("key_value").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: aliasSource("source").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("owner_aliases_key_uq").on(t.keyType, t.keyValue),
    index("owner_aliases_user_idx").on(t.userId),
  ],
);

export const vpnConfigs = pgTable(
  "vpn_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerKeyType: ownerKeyType("owner_key_type").notNull(),
    ownerKeyValue: text("owner_key_value").notNull(),
    // Id from the config type registry (src/server/vpn/types). Plain text so
    // a new type doesn't need a migration.
    type: text("type").notNull(),
    label: text("label").notNull(),
    status: configStatus("status").notNull().default("active"),
    // The person this config belongs to, fixed the first time its owner key
    // resolves to someone. Changing an alias later never hands the encrypted
    // contents to a different person — they stay with the claimed owner.
    claimedByUserId: text("claimed_by_user_id").references(() => user.id, { onDelete: "set null" }),
    lastDownloadedAt: timestamp("last_downloaded_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("vpn_configs_owner_type_label_uq").on(t.ownerKeyType, t.ownerKeyValue, t.type, t.label),
    index("vpn_configs_owner_idx").on(t.ownerKeyType, t.ownerKeyValue),
    index("vpn_configs_claimed_idx").on(t.claimedByUserId),
  ],
);

export const vpnConfigVersions = pgTable(
  "vpn_config_versions",
  {
    id: uuid("id").primaryKey(),
    configId: uuid("config_id")
      .notNull()
      .references(() => vpnConfigs.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    // Only the active version is downloadable; older ones are history/rollback.
    isActive: boolean("is_active").notNull(),
    keyId: text("key_id").notNull(),
    iv: bytea("iv").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    // SHA-256 of the plaintext, to detect "same file imported again".
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    originalFilename: text("original_filename").notNull(),
    source: importSource("source").notNull(),
    importedByOid: text("imported_by_oid"),
    importedByUpn: text("imported_by_upn"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("vpn_config_versions_config_version_uq").on(t.configId, t.version),
    uniqueIndex("vpn_config_versions_one_active_uq")
      .on(t.configId)
      .where(sql`${t.isActive}`),
  ],
);

// Files the importer could not accept. Kept (encrypted) for 30 days so an
// admin can fix the owner/type/label and accept them, or delete them.
export const quarantineItems = pgTable(
  "quarantine_items",
  {
    id: uuid("id").primaryKey(),
    originalFilename: text("original_filename").notNull(),
    reason: text("reason").notNull(),
    detail: text("detail"),
    // Whatever could be parsed from the name: { ownerKey, type, label }.
    parsed: jsonb("parsed").$type<{ ownerKey?: string; type?: string; label?: string }>(),
    keyId: text("key_id"),
    iv: bytea("iv"),
    ciphertext: bytea("ciphertext"),
    sizeBytes: integer("size_bytes").notNull(),
    // SHA-256 of the raw file, so importing the same broken file twice keeps one entry.
    sha256: text("sha256").notNull(),
    source: importSource("source").notNull(),
    createdByOid: text("created_by_oid"),
    createdByUpn: text("created_by_upn"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("quarantine_items_created_idx").on(t.createdAt)],
);

// Fixed-window counters for rate limiting (downloads, reveals, imports).
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});
