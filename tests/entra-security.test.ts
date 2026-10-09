import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { entraTokenVerifier } from "@/server/auth/entra-security";

describe("Entra ID token verification", () => {
  const tenant = "11111111-1111-4111-8111-111111111111";
  const authority = "https://login.microsoftonline.com";
  const client = "22222222-2222-4222-8222-222222222222";
  let privateKey: CryptoKey;
  let verify: ReturnType<typeof entraTokenVerifier>;
  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    verify = entraTokenVerifier(authority, tenant, client, createLocalJWKSet({
      keys: [{ ...await exportJWK(pair.publicKey), kid: "test", alg: "RS256" }],
    }));
  });
  async function token(overrides: Record<string, unknown> = {}, signingKey = privateKey) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ iss: `${authority}/${tenant}/v2.0`, aud: client, tid: tenant,
      sub: "subject", oid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nonce: "flow-nonce",
      iat: now, exp: now + 3600, ...overrides })
      .setProtectedHeader({ alg: "RS256", kid: "test" }).sign(signingKey);
  }
  it("accepts a valid signed token bound to this app, tenant and flow", async () => {
    expect(await verify(await token(), "flow-nonce")).toMatchObject({ tid: tenant, aud: client });
  });
  it.each([
    { aud: "wrong-app" }, { aud: [client, "untrusted-app"] }, { tid: "wrong-tenant" },
    { iss: "https://wrong.example.test" }, { exp: 1 }, { nonce: "other-flow" },
    { iat: 1 }, { nbf: 4_000_000_000 }, { azp: "other-app" }, { sub: undefined },
  ])("rejects invalid claims %j", async (claims) => {
    await expect(verify(await token(claims), "flow-nonce")).rejects.toThrow();
  });
  it("rejects a token signed with another key", async () => {
    const other = await generateKeyPair("RS256");
    await expect(verify(await token({}, other.privateKey), "flow-nonce")).rejects.toThrow();
  });
  it("requires server-side nonce state", async () => {
    await expect(verify(await token(), undefined)).rejects.toThrow();
  });
  it("rejects unsigned and malformed tokens", async () => {
    await expect(verify("eyJhbGciOiJub25lIn0.e30.", "flow-nonce")).rejects.toThrow();
    await expect(verify("not-a-jwt", "flow-nonce")).rejects.toThrow();
  });
});
