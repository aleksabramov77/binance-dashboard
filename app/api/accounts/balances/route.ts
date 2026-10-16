import { connection } from "next/server";
import { getAccountBalances } from "@/app/server/accountBalances";
import { withLogging } from "@/shared/lib/route.server";

// Остатки Demo и Real по группам активов — для шапки (spec 0038). Сервер кэширует ответ бирж на 60 с.
export const GET = withLogging(
  "accounts.balances",
  async () => {
    await connection();
    return Response.json(await getAccountBalances());
  },
  { quiet: true },
);
