import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/env";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  BETTER_AUTH_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "x".repeat(48),
  CONFIG_ENC_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`,
  CONFIG_ENC_ACTIVE_KEY_ID: "k1",
  ALLOWED_UPN_DOMAINS: "example.test",
};
const entra = {
  ENTRA_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  ENTRA_CLIENT_ID: "22222222-2222-4222-8222-222222222222",
  ENTRA_CLIENT_SECRET: "secret",
};

describe("env", () => {
  it("enables mock auth only in development with AUTH_MOCK=true", () => {
    expect(parseEnv({ ...base, NODE_ENV: "development", AUTH_MOCK: "true" }).authMockEnabled).toBe(true);
    expect(parseEnv({ ...base, ...entra, NODE_ENV: "development", AUTH_MOCK: "false" }).authMockEnabled).toBe(false);
    expect(parseEnv({ ...base, ...entra, NODE_ENV: "test", AUTH_MOCK: "true" }).authMockEnabled).toBe(false);
  });

  it("refuses to start in production when AUTH_MOCK is set to anything", () => {
    for (const value of ["true", "false", "0"]) {
      expect(() => parseEnv({ ...base, ...entra, NODE_ENV: "production", AUTH_MOCK: value })).toThrow(/AUTH_MOCK/);
    }
  });

  it("treats an empty AUTH_MOCK= line as unset", () => {
    expect(parseEnv({ ...base, ...entra, BETTER_AUTH_URL: "https://portal.example.test", NODE_ENV: "production", AUTH_MOCK: "" }).isProduction).toBe(true);
  });

  it("requires a sign-in method", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production" })).toThrow(/No sign-in method/);
  });

  it("rejects a partial Entra configuration", () => {
    expect(() =>
      parseEnv({ ...base, NODE_ENV: "production", ENTRA_TENANT_ID: entra.ENTRA_TENANT_ID }),
    ).toThrow(/all of ENTRA_/);
  });

  it("requires the active encryption key to exist", () => {
    expect(() => parseEnv({ ...base, ...entra, CONFIG_ENC_ACTIVE_KEY_ID: "k2" })).toThrow(/CONFIG_ENC_ACTIVE_KEY_ID/);
  });

  it("rejects a short session secret", () => {
    expect(() => parseEnv({ ...base, ...entra, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it.each(["BETTER_AUTH_URL", "ENTRA_AUTHORITY"])("requires HTTPS in production for %s", (field) => {
    expect(() => parseEnv({ ...base, ...entra, NODE_ENV: "production", BETTER_AUTH_URL: "https://portal.example.test", [field]: "http://localhost:3000" })).toThrow(field);
  });

  it.each(["https://user:password@example.test", "https://example.test/path", "https://example.test?x=y", "http://identity.example.test"])("rejects unsafe authority %s", (authority) => {
    expect(() => parseEnv({ ...base, ...entra, ENTRA_AUTHORITY: authority })).toThrow("ENTRA_AUTHORITY");
  });
});
