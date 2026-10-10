import { authConfig, nextAuth } from "@/app/server/auth";
import { authFallbackHandler } from "@/app/server/authFallback";

const notConfigured = authFallbackHandler(authConfig.mode);

export const GET = nextAuth?.handlers.GET ?? notConfigured;
export const POST = nextAuth?.handlers.POST ?? notConfigured;
