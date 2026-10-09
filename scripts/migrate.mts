// Applies pending SQL migrations from ./drizzle, then (in production) makes
// sure the restricted runtime role exists with the right privileges.
//
//   DATABASE_URL     owner connection (runs the migrations)
//   APP_DB_PASSWORD  if set: create/update role "portal_app" with this password.
//                    The app then connects as portal_app, which can read and
//                    write data but can't change the schema, and can only
//                    INSERT/SELECT the audit log — so the append-only trigger
//                    can't be disabled from the app.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { escapeLiteral, Pool } from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const APP_ROLE = "portal_app";

const pool = new Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");

  const password = process.env.APP_DB_PASSWORD;
  if (password) {
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
          CREATE ROLE ${APP_ROLE} LOGIN;
        END IF;
        EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${APP_ROLE}', current_database());
      END $$;`);
    await pool.query(`ALTER ROLE ${APP_ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${escapeLiteral(password)}`);
    await pool.query(`
      GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
      REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM ${APP_ROLE};`);
    console.log(`Runtime role "${APP_ROLE}" up to date.`);
  }
} finally {
  await pool.end();
}
