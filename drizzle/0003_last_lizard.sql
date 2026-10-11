CREATE TABLE "demo_mirror_orders" (
	"trade_id" text PRIMARY KEY NOT NULL,
	"experiment_id" text NOT NULL,
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"demo_ref" text,
	"entry_price" double precision,
	"quantity" double precision,
	"message" text DEFAULT '' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "demo_mirror_orders" ADD CONSTRAINT "demo_mirror_orders_trade_id_paper_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."paper_trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_mirror_orders_status_idx" ON "demo_mirror_orders" USING btree ("status");