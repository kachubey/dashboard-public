import { sql } from "drizzle-orm";
import { db } from "./db";

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets (only meaningful when !ok). */
  retryAfter: number;
}

/**
 * Fixed-window counter stored in Postgres, so limits survive restarts and
 * hold across several app instances. `key` should include the action and
 * the user, e.g. "download:<userId>".
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const result = await db.execute<{ count: number; window_start: Date }>(sql`
    insert into rate_limits (key, window_start, count)
    values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   then now() else rate_limits.window_start end
    returning count, window_start
  `);
  const row = result.rows[0]!;
  const elapsed = (Date.now() - new Date(row.window_start).getTime()) / 1000;
  return { ok: row.count <= limit, retryAfter: Math.max(1, Math.ceil(windowSeconds - elapsed)) };
}

export const LIMITS = {
  download: { limit: 30, windowSeconds: 600 },
  reveal: { limit: 30, windowSeconds: 600 },
  import: { limit: 20, windowSeconds: 600 },
} as const;
