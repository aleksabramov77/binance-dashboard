ALTER TABLE "experiments" ADD COLUMN IF NOT EXISTS "live_mirror_mode" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN IF NOT EXISTS "live_loss_limit_usd" double precision DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN IF NOT EXISTS "live_loss_streak" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN IF NOT EXISTS "live_auto_off_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN IF NOT EXISTS "live_auto_off_reason" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN IF NOT EXISTS "live_mirror_advice" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN IF NOT EXISTS "live_mirror_auto" jsonb;--> statement-breakpoint
UPDATE "experiments" SET "live_mirror_mode" = CASE WHEN "live_mirror" THEN 'on' ELSE 'off' END;