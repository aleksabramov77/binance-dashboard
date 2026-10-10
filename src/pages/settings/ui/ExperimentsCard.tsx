"use client";

import {
  type LabSettings,
  useSetExperimentEnabled,
} from "@/entities/experiment";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Switch } from "@/shared/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

const MARKET_LABEL = { spot: "Spot", futures: "Futures" } as const;

/** Список экспериментов: вкл/выкл каждого; demo-зеркало пока только хранится (задача 6). */
export function ExperimentsCard({
  experiments,
}: {
  experiments: LabSettings["experiments"];
}) {
  const toggle = useSetExperimentEnabled();
  const enabled = experiments.filter((e) => e.enabled).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Эксперименты</CardTitle>
        <CardDescription>
          Включено {enabled} из {experiments.length}. Выключенный эксперимент не
          открывает новые сделки; уже открытые доводятся до выхода.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {toggle.error && (
          <p className="mb-3 text-sm text-destructive">
            {toggle.error.message}
          </p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">ID</TableHead>
              <TableHead className="w-20">Рынок</TableHead>
              <TableHead>Суть</TableHead>
              <TableHead className="w-24 text-center">Включён</TableHead>
              <TableHead className="w-36 text-center">Demo-зеркало</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {experiments.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono">{e.id}</TableCell>
                <TableCell>{MARKET_LABEL[e.market]}</TableCell>
                <TableCell className="whitespace-normal">
                  <div className="font-medium">{e.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {e.hypothesis}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <Switch
                    checked={e.enabled}
                    disabled={toggle.isPending && toggle.variables?.id === e.id}
                    aria-label={`Эксперимент ${e.id}`}
                    onCheckedChange={(checked) =>
                      toggle.mutate({ id: e.id, enabled: checked })
                    }
                  />
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex flex-col items-center gap-1">
                    <Switch
                      checked={e.demoMirror}
                      disabled
                      aria-label={`Demo-зеркало ${e.id}`}
                    />
                    <span className="text-xs text-muted-foreground">
                      скоро (задача 6)
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
