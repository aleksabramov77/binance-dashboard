import { buildOverview, collectSnapshot } from "@/features/collect-snapshot";

async function main() {
  const { snapshot } = await collectSnapshot();
  const { changes } = await buildOverview();
  const fresh = changes.filter((c) => c.at === snapshot.fetchedAt);
  console.log(
    `[binance-dashboard] ${snapshot.fetchedAt}: ${snapshot.offers.length} предложений → БД`,
  );
  console.log(
    `[binance-dashboard] изменений с прошлого снимка: ${fresh.length}`,
  );
}

main().catch((error) => {
  console.error("[binance-dashboard] снимок не удался:", error);
  process.exit(1);
});
