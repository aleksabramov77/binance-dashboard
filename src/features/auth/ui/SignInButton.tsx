"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { Button } from "@/shared/ui/button";

export function SignInButton({ callbackUrl }: { callbackUrl: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      size="lg"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signIn("github", { redirectTo: callbackUrl });
      }}
    >
      {pending ? "Переходим на GitHub…" : "Войти через GitHub"}
    </Button>
  );
}
