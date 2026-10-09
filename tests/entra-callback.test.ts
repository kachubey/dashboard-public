// End-to-end sign-in through the real Better Auth routes against a fake
// Entra token endpoint: /sign-in/social (state + PKCE) → /callback/microsoft.
// This is the path mock sign-in doesn't exercise.
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const BASE = "http://localhost:3000";
const TENANT = "11111111-1111-4111-8111-111111111111";

let claims: Record<string, unknown> = {};
let server: Server;
let nonce: string;

function unsignedJwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "RS256", typ: "JWT" })}.${enc(payload)}.sig`;
}

describe.skipIf(!enabled)("Entra sign-in (callback flow)", async () => {
  beforeAll(async () => {
    process.env.FEATURE_EMPLOYEE_ID = "false";
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "RS256", use: "sig" };
    server = createServer(async (req, res) => {
      if (req.url === `/${TENANT}/discovery/v2.0/keys`) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      if (req.method === "POST" && req.url === `/${TENANT}/oauth2/v2.0/token`) {
        const now = Math.floor(Date.now() / 1000);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            token_type: "Bearer",
            expires_in: 3600,
            access_token: "fake-access-token",
            id_token: await new SignJWT({ iss: `${process.env.ENTRA_AUTHORITY}/${TENANT}/v2.0`, tid: TENANT, aud: process.env.ENTRA_CLIENT_ID, sub: "test-subject", iat: now, exp: now + 3600, nonce, ...claims })
              .setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(privateKey),
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    process.env.ENTRA_AUTHORITY = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await (globalThis as { pgPool?: { end(): Promise<void> } }).pgPool?.end();
  });

  async function signIn(): Promise<{ status: number; location: string; cookies: string[] }> {
    const { getAuth } = await import("@/server/auth");
    const auth = getAuth();
    const start = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { origin: BASE, "content-type": "application/json" },
        body: JSON.stringify({ provider: "microsoft", callbackURL: "/", errorCallbackURL: "/denied", disableRedirect: true }),
      }),
    );
    const { url } = (await start.json()) as { url: string };
    const authorize = new URL(url);
    nonce = authorize.searchParams.get("nonce")!;
    expect(nonce).toBeTruthy();
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    const cookie = start.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const callback = await auth.handler(
      new Request(`${BASE}/api/auth/callback/microsoft?code=fake-code&state=${authorize.searchParams.get("state")}`, {
        headers: { cookie },
      }),
    );
    return {
      status: callback.status,
      location: callback.headers.get("location") ?? "",
      cookies: callback.headers.getSetCookie(),
    };
  }

  const { db, schema } = await import("@/server/db");
  const OID = "eeeeeeee-0000-4000-8000-00000000000e";

  it("first sign-in creates the user with oid, UPN and roles; no tokens are stored", async () => {
    await db.execute(sql`truncate vpn_config_versions, vpn_configs, owner_aliases, "user" cascade`);
    claims = { oid: OID, upn: "Erin.Example@test.example", name: "Erin Example", roles: ["Portal.User", "Portal.Admin", "Other.Role"] };
    const r = await signIn();
    expect(r.status).toBe(302);
    expect(r.location).toBe("/");
    expect(r.cookies.some((c) => c.startsWith("portal.session_token="))).toBe(true);

    const [u] = await db.select().from(schema.user).where(eq(schema.user.oid, OID));
    expect(u).toMatchObject({ upn: "erin.example@test.example", shortUpn: "erin.example", name: "Erin Example", email: `${OID}@oid.invalid` });
    expect(u!.roles.sort()).toEqual(["Portal.Admin", "Portal.User"]);
    const [acc] = await db.select().from(schema.account).where(eq(schema.account.userId, u!.id));
    expect(acc).toMatchObject({ accountId: OID, providerId: "microsoft", accessToken: null, refreshToken: null, idToken: null });
    const aliases = await db.select().from(schema.ownerAliases).where(eq(schema.ownerAliases.userId, u!.id));
    expect(aliases.map((a) => a.keyValue)).toEqual(["erin.example"]);
  });

  it("the next sign-in refreshes roles and UPN from the new token", async () => {
    claims = { oid: OID, upn: "erin.renamed@test.example", name: "Erin Renamed", roles: ["Portal.User"] };
    const r = await signIn();
    expect(r.location).toBe("/");
    const [u] = await db.select().from(schema.user).where(eq(schema.user.oid, OID));
    expect(u).toMatchObject({ upn: "erin.renamed@test.example", shortUpn: "erin.renamed", name: "Erin Renamed", roles: ["Portal.User"] });
  });

  it("a user whose roles were removed gets no session", async () => {
    claims = { oid: OID, upn: "erin.renamed@test.example", name: "Erin Renamed" };
    const before = await db.select().from(schema.session);
    const r = await signIn();
    expect(r.location).toContain("/denied");
    expect(r.cookies.some((c) => c.startsWith("portal.session_token="))).toBe(false);
    expect(await db.select().from(schema.session)).toHaveLength(before.length);
    const [u] = await db.select().from(schema.user).where(eq(schema.user.oid, OID));
    expect(u!.roles).toEqual([]);
  });

  it("a brand-new user without a role is not created a session", async () => {
    claims = { oid: "ffffffff-0000-4000-8000-00000000000f", upn: "norole@test.example", name: "No Role" };
    const r = await signIn();
    expect(r.location).toContain("/denied");
  });

  it("sign-in with a bare ID token is refused", async () => {
    const { getAuth } = await import("@/server/auth");
    const res = await getAuth().handler(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { origin: BASE, "content-type": "application/json" },
        body: JSON.stringify({ provider: "microsoft", idToken: { token: unsignedJwt({ oid: OID }) } }),
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("portal.session_token="))).toBe(false);
  });
  it.each([
    { iss: "https://other.example.test" }, { tid: "33333333-3333-4333-8333-333333333333" },
    { aud: "wrong-client" }, { exp: 1 }, { nonce: "wrong-nonce" }, { sub: undefined },
    { upn: undefined, preferred_username: "erin.renamed@test.example" },
  ])("rejects an ID token with invalid claims: %j", async (override) => {
    claims = { oid: OID, upn: "erin.renamed@test.example", name: "Erin", roles: ["Portal.Admin"], ...override };
    const before = await db.select().from(schema.session);
    const r = await signIn();
    expect(r.location).toContain("/denied");
    expect(await db.select().from(schema.session)).toHaveLength(before.length);
  });

  it.each(["https://other.example.test", "null", undefined])("rejects first sign-in with untrusted or absent Origin: %s", async (origin) => {
    const { getAuth } = await import("@/server/auth");
    const headers = new Headers({ "content-type": "application/json" });
    if (origin !== undefined) headers.set("origin", origin);
    const body = { provider: "microsoft" as const, callbackURL: "/", disableRedirect: true };
    const response = await getAuth().handler(new Request(`${BASE}/api/auth/sign-in/social`, {
      method: "POST", headers, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toHaveLength(0);
    await expect(getAuth().api.signInSocial({ body, headers })).rejects.toMatchObject({ status: "FORBIDDEN" });
  });

  it("rate limits direct auth.api calls as well as HTTP sign-in", async () => {
    const { getAuth } = await import("@/server/auth");
    const headers = new Headers({ origin: BASE, "x-forwarded-for": "192.0.2.77" });
    for (let i = 0; i < 20; i++) {
      await getAuth().api.signInSocial({ body: { provider: "microsoft", callbackURL: "/", disableRedirect: true }, headers });
    }
    await expect(getAuth().api.signInSocial({ body: { provider: "microsoft", callbackURL: "/", disableRedirect: true }, headers }))
      .rejects.toMatchObject({ status: "TOO_MANY_REQUESTS" });
    const response = await getAuth().handler(new Request(`${BASE}/api/auth/sign-in/social`, {
      method: "POST", headers: { origin: BASE, "x-forwarded-for": "192.0.2.77", "content-type": "application/json" },
      body: JSON.stringify({ provider: "microsoft", callbackURL: "/" }),
    }));
    expect(response.status).toBe(429);
  });

});
