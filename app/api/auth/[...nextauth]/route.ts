import { nextAuth } from "@/app/server/auth";

const notConfigured = () =>
  Response.json({ error: "Вход не настроен" }, { status: 404 });

export const GET = nextAuth?.handlers.GET ?? notConfigured;
export const POST = nextAuth?.handlers.POST ?? notConfigured;
