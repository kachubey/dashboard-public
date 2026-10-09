import { sql } from "drizzle-orm";
import { db } from "../db";

export async function adminOverview() {
  const result = await db.execute<{
    active: number;
    pending: number;
    not_downloaded: number;
    quarantine: number;
    users: number;
  }>(sql`
    select
      (select count(*)::int from vpn_configs where status = 'active') as active,
      (select count(*)::int from vpn_configs where status = 'active' and claimed_by_user_id is null) as pending,
      (select count(*)::int from vpn_configs where status = 'active' and last_downloaded_at is null) as not_downloaded,
      (select count(*)::int from quarantine_items where expires_at > now()) as quarantine,
      (select count(*)::int from "user") as users
  `);
  return result.rows[0]!;
}
