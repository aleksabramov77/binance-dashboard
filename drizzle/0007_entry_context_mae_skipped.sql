-- spec 0030: контекст входа и MAE paper-сделок, журнал отсечённых сигналов. Идемпотентна: повторный запуск
-- (или частично применённая миграция) ничего не ломает. Старые сделки получают entry_context = '{}' и mae = null.
CREATE TABLE IF NOT EXISTS "skipped_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"experiment_id" text NOT NULL,
	"market" text NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"bar" bigint NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"entry_price" double precision NOT NULL,
	"stop" double precision,
	"take_profit" double precision
);
--> statement-breakpoint
ALTER TABLE "paper_trades" ADD COLUMN IF NOT EXISTS "mae" double precision;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD COLUMN IF NOT EXISTS "entry_context" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "skipped_signals" ADD CONSTRAINT "skipped_signals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "skipped_signals" ADD CONSTRAINT "skipped_signals_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skipped_signals_run_experiment_idx" ON "skipped_signals" USING btree ("run_id","experiment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skipped_signals_at_idx" ON "skipped_signals" USING btree ("at");
