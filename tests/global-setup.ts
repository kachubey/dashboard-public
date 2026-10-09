// Runs once before all test files: wipes the throwaway test database and
// applies every migration, so each file starts from the current schema.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export default async function setup() {
  try {
    process.loadEnvFile(".env.test");
  } catch {
    return; // no test database configured — integration tests are skipped
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
}
