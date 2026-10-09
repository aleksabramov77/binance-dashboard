/** Котируемые валюты Binance; стейблкоины раньше BTC/ETH, чтобы BTCUSDT не делился как …/BTC. */
const QUOTES = [
  "USDT",
  "USDC",
  "FDUSD",
  "TUSD",
  "BUSD",
  "BTC",
  "ETH",
  "BNB",
  "EUR",
  "TRY",
];

/** BATUSDT → { base: "BAT", quote: "USDT" }; неизвестная котируемая — весь символ в base. */
export function splitSymbol(symbol: string): { base: string; quote: string } {
  const quote = QUOTES.find(
    (q) => symbol.endsWith(q) && symbol.length > q.length,
  );
  return quote
    ? { base: symbol.slice(0, -quote.length), quote }
    : { base: symbol, quote: "" };
}

/** BATUSDT → BAT-USDT. */
export function formatPair(symbol: string): string {
  const { base, quote } = splitSymbol(symbol);
  return quote ? `${base}-${quote}` : symbol;
}
