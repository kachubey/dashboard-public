// Test environment. Unit tests need no database; integration tests use
// TEST_DATABASE_URL from .env.test (see .env.test.example) and are skipped
// when it isn't set.
try {
  process.loadEnvFile(".env.test");
} catch {
  // no .env.test — integration tests will be skipped
}

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://unused@localhost:1/unused",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "test-secret-".padEnd(48, "x"),
  ENTRA_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  ENTRA_CLIENT_ID: "22222222-2222-4222-8222-222222222222",
  ENTRA_CLIENT_SECRET: "test",
  // Two keys so rotation can be exercised; "t2" is active.
  CONFIG_ENC_KEYS: `t1:${Buffer.alloc(32, 1).toString("base64")},t2:${Buffer.alloc(32, 2).toString("base64")}`,
  CONFIG_ENC_ACTIVE_KEY_ID: "t2",
  FEATURE_EMPLOYEE_ID: "true",
});
