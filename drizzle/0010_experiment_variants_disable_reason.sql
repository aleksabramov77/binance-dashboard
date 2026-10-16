-- spec 0046 (миграция 0010, после 0009_mirror_auto из spec 0043): варианты эксперимента (parent_id, variant_note) и причина последнего выключения (disabled_*).
-- Идемпотентна: повторный запуск (или частично применённая миграция) ничего не ломает. Все колонки null —
-- старые строки остаются самостоятельными экспериментами, выключенные — без причины до backfill.
ALTER TABLE "experiments" ADD COLUMN IF NOT EXISTS "parent_id" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN IF NOT EXISTS "variant_note" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN IF NOT EXISTS "disabled_reason" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN IF NOT EXISTS "disabled_note" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN IF NOT EXISTS "disabled_at" timestamp with time zone;
