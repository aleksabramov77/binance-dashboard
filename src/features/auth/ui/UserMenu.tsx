"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/shared/ui/button";
import { useSession } from "../api/useSession";

/** Аватар и логин GitHub + «Выйти». Локально без настроек входа — пометка «вход отключён». */
export function UserMenu() {
  const { data: auth } = useSession();
  if (auth?.status === "disabled")
    return (
      <span
        className="text-muted-foreground text-xs"
        title="AUTH_SECRET не задан — защита выключена (только локально)"
      >
        Вход отключён локально
      </span>
    );
  if (auth?.status !== "signed-in") return null;
  const { login, name, image } = auth.user;
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
