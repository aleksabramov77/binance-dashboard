-- spec 0023, AC2: внутреннее имя группы USDⓈ-M — usdm вместо futures (рядом с новой группой coinm).
-- Разовая правка данных лаборатории; повторный запуск ничего не меняет. Журнал (app_logs) не мигрируется:
-- хранится 14 дней, старые записи читаются через legacyMarketSchema / preprocess.
UPDATE "experiments" SET "market" = 'usdm', "updated_at" = now() WHERE "market" = 'futures';
--> statement-breakpoint
UPDATE "paper_trades" SET "market" = 'usdm' WHERE "market" = 'futures';
--> statement-breakpoint
UPDATE "demo_mirror_orders" SET "market" = 'usdm', "updated_at" = now() WHERE "market" = 'futures';
--> statement-breakpoint
UPDATE "demo_mirror_orders"
SET "protect_refs" = jsonb_set("protect_refs", '{market}', '"usdm"')
WHERE "protect_refs" ->> 'market' = 'futures';
