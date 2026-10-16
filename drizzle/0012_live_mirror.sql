CREATE TABLE "live_mirror_orders" (
	"trade_id" text PRIMARY KEY NOT NULL,
	"experiment_id" text NOT NULL,
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"live_ref" text,
	"entry_price" double precision,
	"quantity" double precision,
	"notional_usd" double precision,
	"exit_price" double precision,
	"fees_usd" double precision,
	"realized_pnl" double precision,
	"closed_by" text,
	"message" text DEFAULT '' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"protect_refs" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "live_trading_halt" (
	"id" text PRIMARY KEY NOT NULL,
	"stopped" boolean DEFAULT false NOT NULL,
	"stopped_at" timestamp with time zone,
	"stopped_by" text,
	"close_all_requested_at" timestamp with time zone,
	"close_all_requested_by" text,
	"close_all_done_at" timestamp with time zone,
	"close_all_result" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "live_mirror" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "live_mirror_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "live_mirror_by" text;--> statement-breakpoint
ALTER TABLE "live_mirror_orders" ADD CONSTRAINT "live_mirror_orders_trade_id_paper_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."paper_trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_mirror_orders_status_idx" ON "live_mirror_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "live_mirror_orders_experiment_closed_idx" ON "live_mirror_orders" USING btree ("experiment_id","closed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "live_mirror_orders_active_coin_uq" ON "live_mirror_orders" USING btree ("market","symbol") WHERE "live_mirror_orders"."status" in ('pending', 'protected', 'unprotected', 'closing', 'close_failed');