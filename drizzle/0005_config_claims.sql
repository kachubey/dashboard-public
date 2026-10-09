ALTER TYPE "public"."audit_action" ADD VALUE 'sessions_revoke';--> statement-breakpoint
ALTER TABLE "vpn_configs" ADD COLUMN "claimed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "vpn_configs" ADD CONSTRAINT "vpn_configs_claimed_by_user_id_user_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vpn_configs_claimed_idx" ON "vpn_configs" USING btree ("claimed_by_user_id");--> statement-breakpoint
-- Existing configs: claim them for whoever their owner key points at today.
UPDATE "vpn_configs" c SET "claimed_by_user_id" = a."user_id"
FROM "owner_aliases" a
WHERE a."key_type" = c."owner_key_type" AND a."key_value" = c."owner_key_value" AND c."claimed_by_user_id" IS NULL;
