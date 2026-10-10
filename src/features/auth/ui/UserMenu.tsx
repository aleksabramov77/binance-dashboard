"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/shared/ui/button";
import { useSession } from "../api/useSession";

/** Аватар и логин GitHub + «Выйти». Без входа (локальный режим) ничего не показывает. */
export function UserMenu() {
  const { data: session } = useSession();
  if (!session) return null;
  const { login, name, image } = session.user;
  return (
    <div className="flex items-center gap-2 text-sm">
      {image ? (
        // biome-ignore lint/performance/noImgElement: аватар GitHub, next/image потребовал бы remotePatterns
        <img
          src={image}
          alt=""
          className="size-7 rounded-full border"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <span className="hidden text-muted-foreground sm:inline">
        {login ?? name}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void signOut({ redirectTo: "/login" })}
      >
        <LogOut />
        Выйти
      </Button>
    </div>
  );
}
