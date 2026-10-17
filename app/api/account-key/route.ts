import { connection } from "next/server";
import {
  deleteAccountKey,
  getAccountKeyStatus,
  saveAccountKey,
} from "@/app/server/accountKey";
import { nextAuth } from "@/app/server/auth";
import { accountKeyInputSchema } from "@/entities/account-key";
import { withLogging } from "@/shared/lib/route.server";

// Ключ основного аккаунта Binance (spec 0065), за общим входом владельца (proxy.ts). Ответы — статус без ключа и
// секрета; PUT проверяет права ключа в Binance и только тогда сохраняет его в базе в зашифрованном виде.

const by = async () => {
  const session = nextAuth ? await nextAuth.auth() : null;
  return session?.user?.login ?? null;
};

export const GET = withLogging(
  "account-key",
  async () => {
    await connection();
    return Response.json(getAccountKeyStatus());
  },
  { quiet: true },
);

export const PUT = withLogging("account-key", async (request) => {
  // Только JSON: форма с чужого сайта не может прислать application/json без CORS-проверки браузера.
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type))
    return Response.json(
      { error: "Ожидается Content-Type: application/json" },
      { status: 415 },
    );
  const parsed = accountKeyInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  // Текст ошибки — из сообщений схемы: введённое значение в них не попадает.
  if (!parsed.success)
    return Response.json(
      {
        error:
          parsed.error.issues[0]?.message ?? "Ожидается { apiKey, apiSecret }",
      },
      { status: 400 },
    );
  const result = await saveAccountKey(parsed.data, { by: await by() });
  if (result.ok) return Response.json(result.status);
  return Response.json(
    { error: result.error, reasons: result.reasons, flags: result.flags },
    { status: result.status },
  );
});

export const DELETE = withLogging("account-key", async () =>
  Response.json(deleteAccountKey({ by: await by() })),
);
