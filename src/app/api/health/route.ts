import { sql } from "drizzle-orm";
import { db } from "@/server/db";

// Liveness + database check for the container healthcheck and monitoring.
// Deliberately says nothing about versions or configuration.
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
