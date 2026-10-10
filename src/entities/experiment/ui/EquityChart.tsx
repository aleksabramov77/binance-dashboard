"use client";

import { useState } from "react";
import { cn, formatDateTime, formatUsd } from "@/shared/lib";
import type { EquityPointView } from "../model/view";

// Equity-кривая эксперимента: простой inline SVG без библиотек графиков. Шаг «ступенькой»:
// equity меняется только в момент закрытия сделки. Одна серия — легенда не нужна, подпись в заголовке.

const W = 720;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 24, left: 72 };

export function EquityChart({
  points,
  initialBudget,
  className,
}: {
  points: EquityPointView[];
  initialBudget: number;
  className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  // Правый край — «сейчас», чтобы последняя ступень тянулась до текущего момента.
  const [now] = useState(() => Date.now());

  if (points.length < 2)
    return (
      <p
        className={cn(
          "rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        Кривая появится после первой закрытой сделки.
      </p>
    );

  const times = points.map((p) => Date.parse(p.at));
  const t0 = Math.min(...times);
  const t1 = Math.max(now, times[times.length - 1]);
  const values = points.map((p) => p.equity);
  const min = Math.min(...values, initialBudget);
  const max = Math.max(...values, initialBudget);
  const span = max - min || 1;
  const x = (t: number) =>
    PAD.left + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + (1 - (v - min) / span) * (H - PAD.top - PAD.bottom);

  let d = `M${x(times[0])},${y(values[0])}`;
  for (let i = 1; i < points.length; i++)
    d += `H${x(times[i])}V${y(values[i])}`;
  d += `H${x(t1)}`;

  const last = values[values.length - 1];
  const up = last >= initialBudget;
  const active = hover === null ? null : points[hover];

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < times.length; i++)
      if (Math.abs(x(times[i]) - px) < Math.abs(x(times[best]) - px)) best = i;
    setHover(best);
  }

  return (
    <figure className={cn("flex flex-col gap-2", className)}>
      {/* Подпись над графиком, а не поверх: не закрывает последние точки кривой. */}
      <figcaption className="h-4 text-xs text-muted-foreground">
        {active ? (
          <>
            {formatDateTime(active.at)}{" "}
            <span className="font-mono font-semibold text-foreground tabular-nums">
              {formatUsd(active.equity)}
            </span>
          </>
        ) : (
          "Наведите на график, чтобы увидеть equity после сделки"
        )}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-label={`Equity от ${formatUsd(initialBudget)} до ${formatUsd(last)}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {[max, initialBudget, min].map((v, i) => (
          <g key={`${i}-${v}`}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(v)}
              y2={y(v)}
              className="stroke-border"
              strokeDasharray={v === initialBudget ? "4 4" : undefined}
            />
            <text
              x={PAD.left - 8}
              y={y(v)}
              dy="0.32em"
              textAnchor="end"
              className="fill-muted-foreground text-[11px] tabular-nums"
            >
              {formatUsd(v)}
            </text>
          </g>
        ))}
        <text
          x={PAD.left}
          y={H - 6}
          className="fill-muted-foreground text-[11px]"
        >
          {formatDateTime(points[0].at)}
        </text>
        <text
          x={W - PAD.right}
          y={H - 6}
          textAnchor="end"
          className="fill-muted-foreground text-[11px]"
        >
          сейчас
        </text>
        <path
          d={d}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          className={up ? "stroke-positive" : "stroke-destructive"}
        />
        {active && hover !== null && (
          <g>
            <line
              x1={x(times[hover])}
              x2={x(times[hover])}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className="stroke-muted-foreground"
              strokeWidth={1}
            />
            <circle
              cx={x(times[hover])}
              cy={y(active.equity)}
              r={4}
              strokeWidth={2}
              className={cn(
                "stroke-card",
                up ? "fill-positive" : "fill-destructive",
              )}
            />
          </g>
        )}
      </svg>
    </figure>
  );
}
