"use client";

import { cn, formatDateTime } from "@/shared/lib";
import { Badge } from "@/shared/ui/Badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/Popover";
import { DISABLE_REASONS, type DisabledInfo } from "../model/disable";

/** Текст подсказки: категория, текст и дата выключения. */
function details(d: DisabledInfo): string {
  return [
    d.reason ? DISABLE_REASONS[d.reason] : null,
    d.note,
    d.at ? `выключен ${formatDateTime(d.at)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Бейдж выключенного эксперимента (spec 0046): «выключен · <категория>»; наведение — подсказка, тап — поповер с
 * текстом и датой. Без причины (строки до spec 0046) — просто «выключен».
 */
export function DisabledBadge({
  disabled,
  className,
}: {
  disabled: DisabledInfo | null;
  className?: string;
}) {
  if (!disabled?.reason)
    return (
      <Badge variant="outline" className={className}>
        выключен
      </Badge>
    );
  const label = DISABLE_REASONS[disabled.reason];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge
          asChild
          variant="outline"
          className={cn("cursor-help", className)}
        >
          <button
            type="button"
            title={details(disabled)}
            // Бейдж стоит в строке со ссылкой на эксперимент: тап открывает причину, а не страницу.
            onClick={(e) => e.stopPropagation()}
          >
            выключен · {label}
          </button>
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="flex w-64 flex-col gap-1 text-sm">
        <span className="font-medium">Выключен: {label}</span>
        {disabled.note && <span>{disabled.note}</span>}
        {disabled.at && (
          <span className="text-xs text-muted-foreground">
            {formatDateTime(disabled.at)}
          </span>
        )}
      </PopoverContent>
    </Popover>
  );
}
