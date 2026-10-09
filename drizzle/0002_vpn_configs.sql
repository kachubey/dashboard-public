CREATE TYPE "public"."alias_source" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."config_status" AS ENUM('active', 'deactivated', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."import_source" AS ENUM('upload', 'cli', 'manifest', 'provider', 'seed');--> statement-breakpoint
CREATE TYPE "public"."owner_key_type" AS ENUM('short_upn', 'employee_code');--> statement-breakpoint
CREATE TABLE "owner_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_type" "owner_key_type" NOT NULL,
	"key_value" text NOT NULL,
	"user_id" text NOT NULL,
	"source" "alias_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_aliases_key_uq" UNIQUE("key_type","key_value")
);
--> statement-breakpoint
CREATE TABLE "quarantine_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"original_filename" text NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"parsed" jsonb,
	"key_id" text,
	"iv" "bytea",
	"ciphertext" "bytea",
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"source" "import_source" NOT NULL,
	"created_by_oid" text,
	"created_by_upn" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vpn_config_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"config_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"is_active" boolean NOT NULL,
	"key_id" text NOT NULL,
	"iv" "bytea" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"original_filename" text NOT NULL,
	"source" "import_source" NOT NULL,
	"imported_by_oid" text,
	"imported_by_upn" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vpn_config_versions_config_version_uq" UNIQUE("config_id","version")
);
--> statement-breakpoint
CREATE TABLE "vpn_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_key_type" "owner_key_type" NOT NULL,
	"owner_key_value" text NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"status" "config_status" DEFAULT 'active' NOT NULL,
	"last_downloaded_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vpn_configs_owner_type_label_uq" UNIQUE("owner_key_type","owner_key_value","type","label")
);
--> statement-breakpoint
ALTER TABLE "owner_aliases" ADD CONSTRAINT "owner_aliases_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vpn_config_versions" ADD CONSTRAINT "vpn_config_versions_config_id_vpn_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."vpn_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owner_aliases_user_idx" ON "owner_aliases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "quarantine_items_created_idx" ON "quarantine_items" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vpn_config_versions_one_active_uq" ON "vpn_config_versions" USING btree ("config_id") WHERE "vpn_config_versions"."is_active";--> statement-breakpoint
CREATE INDEX "vpn_configs_owner_idx" ON "vpn_configs" USING btree ("owner_key_type","owner_key_value");