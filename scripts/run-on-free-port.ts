// Запускает `next <command>` (или `storybook dev` для команды `storybook`) на первом свободном порту, начиная с 5000
// (или $PORT).
// На macOS 5000 обычно занят AirPlay Receiver — тогда берём 5001, 5002 и т.д.
import { spawn } from "node:child_process";
import net from "node:net";

const START_PORT = Number(process.env.PORT ?? 5000);
const MAX_ATTEMPTS = 50;

function isFreeOn(port: number, host?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

// Next слушает все адреса (::), Storybook — 127.0.0.1: на macOS занятый 127.0.0.1 не мешает слушать ::,
// поэтому проверяем оба.
async function isFree(port: number): Promise<boolean> {
  return (await isFreeOn(port)) && (await isFreeOn(port, "127.0.0.1"));
}

async function findFreePort(): Promise<number> {
  for (let port = START_PORT; port < START_PORT + MAX_ATTEMPTS; port++) {
    if (await isFree(port)) return port;
    console.log(`[binance-dashboard] порт ${port} занят, пробую ${port + 1}`);
  }
  throw new Error(
    `Нет свободного порта в диапазоне ${START_PORT}–${START_PORT + MAX_ATTEMPTS - 1}`,
  );
}

async function main() {
  const [command = "dev", ...args] = process.argv.slice(2);
  const port = await findFreePort();
  const [bin, binArgs] =
    command === "storybook" ? ["storybook", ["dev"]] : ["next", [command]];
  const child = spawn(bin, [...binArgs, "--port", String(port), ...args], {
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
