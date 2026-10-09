import { connection } from "next/server";
import { buildOverview } from "@/features/collect-snapshot";

export async function GET() {
  await connection();
  return Response.json(await buildOverview());
}
