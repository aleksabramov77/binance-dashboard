import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/Card";

/** Почему нет полного каталога: без ключа локально — как вписать его в .env.local; на сервере — ввести в «Настройках». */
export function AdvancedAccessNotice({
  hosting,
}: {
  hosting: "local" | "cloud";
}) {
  if (hosting === "cloud")
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            Полный каталог появится с ключом «только чтение»
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Конкретные предложения (целевые цены, сроки, квоты) Binance отдаёт
            только по ключу аккаунта. Ниже — общие диапазоны ставок из открытой
            сводки Binance.
          </p>
          <p>
            Введите read-only ключ основного аккаунта в{" "}
            <Link href="/settings#account-key" className="underline">
              Настройках
            </Link>{" "}
            → «Основной аккаунт — read-only ключ» — каталог появится без
            перезапуска. Тот же ключ использует раздел «Портфель».
          </p>
        </CardContent>
      </Card>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Полный каталог появится с ключом «только чтение»</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          Конкретные предложения Binance отдаёт только по ключу аккаунта. Ниже —
          общие диапазоны ставок из открытой сводки.
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            binance.com → профиль → <b>API Management</b> → <b>Create API</b>,
            оставьте только <b>Enable Reading</b>.
          </li>
          <li>
            Впишите ключ в <code>.env.local</code>:{" "}
            <code>BINANCE_API_KEY=…</code> и <code>BINANCE_API_SECRET=…</code>.
          </li>
          <li>Перезапустите dev-сервер и обновите страницу.</li>
        </ol>
        <p className="text-muted-foreground">
          Тот же ключ использует раздел «Портфель».
        </p>
      </CardContent>
    </Card>
  );
}
