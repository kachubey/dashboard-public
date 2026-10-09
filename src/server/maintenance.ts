import { sql } from "drizzle-orm";
import { db } from "./db";

/**
 * Housekeeping: removes rows that only grow. Expired sessions and OAuth state
 * are useless; old rate-limit windows are stale; expired quarantine items
 * still hold encrypted secrets and must not linger. The audit log is never
 * touched.
 */
export async function runMaintenance(): Promise<void> {
  await db.execute(sql`delete from session where expires_at < now()`);
  await db.execute(sql`delete from verification where expires_at < now()`);
  await db.execute(sql`delete from rate_limits where window_start < now() - interval '1 day'`);
  await db.execute(sql`delete from quarantine_items where expires_at < now()`);
}
