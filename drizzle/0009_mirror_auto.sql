-- spec 0043: переключатель демо-зеркала «Выкл · Авто · Вкл». AC10: у кого зеркало сейчас включено — ручное «Вкл»
-- (решение пользователя остаётся в силе, автомат только подсказывает), остальные — «Авто» (default колонки).
ALTER TABLE "experiments" ADD COLUMN "demo_mirror_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "demo_mirror_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "demo_mirror_advice" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "demo_mirror_auto" jsonb;--> statement-breakpoint
UPDATE "experiments" SET "demo_mirror_mode" = 'on' WHERE "demo_mirror" = true;
