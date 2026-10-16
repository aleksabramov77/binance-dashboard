ALTER TABLE "live_mirror_orders" ADD COLUMN "close_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "live_mirror_orders" ADD COLUMN "leftover_qty" double precision;--> statement-breakpoint
ALTER TABLE "live_mirror_orders" ADD COLUMN "leftover_usd" double precision;