CREATE TABLE "engine_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"market" text NOT NULL,
	"name" text NOT NULL,
	"hypothesis" text NOT NULL,
	"config" jsonb NOT NULL,
	"initial_budget" double precision NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"demo_mirror" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_trades" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"experiment_id" text NOT NULL,
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"entry_price" double precision NOT NULL,
	"quantity" double precision NOT NULL,
	"initial_stop" double precision,
	"stop" double precision,
	"take_profit" double precision,
	"atr" double precision NOT NULL,
	"extreme" double precision NOT NULL,
	"checked_until" bigint NOT NULL,
	"closed_at" timestamp with time zone,
	"exit_price" double precision,
	"exit_reason" text,
	"fees" double precision DEFAULT 0 NOT NULL,
	"pnl" double precision,
	"r_multiple" double precision,
	"demo_order_ref" text,
	"signal" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paper_trades_run_experiment_idx" ON "paper_trades" USING btree ("run_id","experiment_id");--> statement-breakpoint
CREATE INDEX "paper_trades_run_closed_idx" ON "paper_trades" USING btree ("run_id","closed_at");--> statement-breakpoint
CREATE INDEX "paper_trades_symbol_idx" ON "paper_trades" USING btree ("symbol");