"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AiCreditsBadge } from "@/entities/ai-credits";
import { NAV_ITEMS } from "@/shared/config";
import { cn } from "@/shared/lib";

export function AppHeader() {
  const pathname = usePathname();
  return (
    <header className="border-b bg-card/60 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-8 px-4 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <span className="size-2.5 rotate-45 bg-primary" aria-hidden />
          Binance Dashboard
        </Link>
        <nav className="flex gap-1 text-sm">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground",
                pathname?.startsWith(item.href) &&
                  "bg-secondary text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <AiCreditsBadge />
        </div>
      </div>
    </header>
  );
}
