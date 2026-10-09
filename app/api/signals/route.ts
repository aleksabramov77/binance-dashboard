import { connection } from "next/server";
import { scanMarket } from "@/features/scan-market";

export async function GET() {
  await connection();
  try {
    return Response.json(await scanMarket());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 502 });
  }
}
