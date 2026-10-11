ALTER TABLE "demo_mirror_orders" ADD COLUMN "exit_price" double precision;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "demo_reset_at" timestamp with time zone;