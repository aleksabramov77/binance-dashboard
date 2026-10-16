import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/Card";

/** Почему нет полного каталога: без ключа локально — как включить; в облаке — только на компьютере. */
export function AdvancedAccessNotice({
  hosting,
}: {
  hosting: "local" | "cloud";
}) {
  if (hosting === "cloud")
    return (
      <Card>
        <CardHeader>
          <CardTitle>Полный каталог — только на компьютере с ключом</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Конкретные предложения (целевые цены, сроки, квоты) Binance отдаёт
            только по ключу аккаунта, а ключ в облако не загружается — так
            безопаснее. Ниже — общие диапазоны ставок из открытой сводки
            Binance.
          </p>
          <p className="text-muted-foreground">
            Полный каталог — в дашборде на своём компьютере (
            <code>pnpm dev</code>
            ), где ключ лежит в <code>.env.local</code>.
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
