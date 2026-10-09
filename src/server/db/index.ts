import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../env";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Connection = Db | Transaction;

// One pool per process. In dev, hot reload re-evaluates modules, so the pool
// is kept on globalThis to avoid leaking connections.
const globalForDb = globalThis as unknown as { pgPool?: Pool; drizzleDb?: Db };

function realDb(): Db {
  if (!globalForDb.drizzleDb) {
    globalForDb.pgPool ??= new Pool({ connectionString: env().DATABASE_URL, max: 10 });
    globalForDb.drizzleDb = drizzle(globalForDb.pgPool, { schema });
  }
  return globalForDb.drizzleDb;
}

/**
 * Connected lazily on first use, so importing this module (e.g. during
 * `next build`) needs neither DATABASE_URL nor a running database.
 */
export const db: Db = new Proxy({} as Db, {
  get(_, prop) {
    const target = realDb();
    const value = Reflect.get(target, prop, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

export { schema };
