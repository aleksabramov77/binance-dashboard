import type { Metadata } from "next";
import { Suspense } from "react";
import { EXPERIMENT_CATALOG } from "@/features/paper-engine";
import { ExperimentDetailPage } from "@/pages/experiment-detail";

// id каталога известны при сборке: страницы пререндерятся, и usePathname в хедере не требует
// Suspense (cacheComponents; иначе неизвестный параметр блокирует статическую оболочку).
// Приватные эксперименты (PS01, PF01 — spec 0015) живут только в БД: их id рендерятся по запросу.
// dynamicParams с cacheComponents недоступен — неизвестные id и так открываются, не экспортировать.
export function generateStaticParams() {
  return EXPERIMENT_CATALOG.map((e) => ({ id: e.id }));
}

export async function generateMetadata(
  props: PageProps<"/experiments/[id]">,
): Promise<Metadata> {
  const { id } = await props.params;
  return { title: `Эксперимент ${id}` };
}

// params читаются внутри Suspense: оболочка страницы остаётся мгновенной при навигации.
async function Detail({
  params,
}: Pick<PageProps<"/experiments/[id]">, "params">) {
  const { id } = await params;
  return <ExperimentDetailPage id={id} />;
}

export default function Page(props: PageProps<"/experiments/[id]">) {
  return (
    <Suspense>
      <Detail params={props.params} />
    </Suspense>
  );
}
