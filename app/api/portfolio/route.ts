import { connection } from "next/server";
import { loadPortfolio } from "@/features/load-portfolio";

export async function GET() {
  await connection();
  return Response.json(await loadPortfolio());
}
