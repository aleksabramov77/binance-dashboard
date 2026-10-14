-- spec 0012, AC2: разовая правка данных. Монеты, которых нет на демо-рынке, — пропуск зеркала, а не
-- отказ биржи (запроса на вход не было). Старые строки «… нет в Binance Demo Trading (Futures).»
-- переносим в skipped с текстом новой причины. Повторный запуск ничего не меняет.
UPDATE "demo_mirror_orders"
SET
  "status" = 'skipped',
  "message" = "symbol" || ': нет на ' || CASE "market" WHEN 'spot' THEN 'демо-споте' ELSE 'демо-фьючерсах' END || '.',
  "updated_at" = now()
WHERE "status" = 'rejected' AND "message" LIKE '%нет в Binance Demo Trading%';
