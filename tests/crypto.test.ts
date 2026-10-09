import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { aad, CryptoError, EnvKeyProvider, open, seal } from "@/server/crypto";
import { parseKeyList } from "@/server/env";

const k1 = new EnvKeyProvider(new Map([["k1", randomBytes(32)]]), "k1");

describe("encryption at rest", () => {
  it("round-trips with the right key and AAD", async () => {
    const plain = Buffer.from("[Interface]\nPrivateKey = secret\n");
    const sealed = await seal(plain, aad.configVersion("c1", "v1"), k1);
    expect(sealed.keyId).toBe("k1");
    expect(sealed.iv).toHaveLength(12);
    expect(sealed.ciphertext.includes(plain)).toBe(false);
    expect((await open(sealed, aad.configVersion("c1", "v1"), k1)).equals(plain)).toBe(true);
  });

  it("uses a fresh IV every time", async () => {
    const a = await seal(Buffer.from("x"), "aad", k1);
    const b = await seal(Buffer.from("x"), "aad", k1);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("fails when the ciphertext is moved to another row (AAD mismatch)", async () => {
    const sealed = await seal(Buffer.from("secret"), aad.configVersion("c1", "v1"), k1);
    await expect(open(sealed, aad.configVersion("c1", "v2"), k1)).rejects.toBeInstanceOf(CryptoError);
  });

  it("fails when a version is moved to another config", async () => {
    const sealed = await seal(Buffer.from("secret"), aad.configVersion("c1", "v1"), k1);
    await expect(open(sealed, aad.configVersion("c2", "v1"), k1)).rejects.toBeInstanceOf(CryptoError);
  });

  it("fails on tampering", async () => {
    const sealed = await seal(Buffer.from("secret"), "a", k1);
    sealed.ciphertext[0]! ^= 1;
    await expect(open(sealed, "a", k1)).rejects.toThrow(/Decryption failed/);
  });

  it("decrypts with an old key after rotation, encrypts with the new one", async () => {
    const old = randomBytes(32);
    const before = new EnvKeyProvider(new Map([["old", old]]), "old");
    const sealed = await seal(Buffer.from("secret"), "a", before);
    const after = new EnvKeyProvider(new Map([["old", old], ["new", randomBytes(32)]]), "new");
    expect((await open(sealed, "a", after)).toString()).toBe("secret");
    expect((await seal(Buffer.from("x"), "a", after)).keyId).toBe("new");
  });

  it("fails with an unknown key id", async () => {
    const sealed = await seal(Buffer.from("secret"), "a", k1);
    const other = new EnvKeyProvider(new Map([["k9", randomBytes(32)]]), "k9");
    await expect(open(sealed, "a", other)).rejects.toThrow(/Unknown encryption key/);
  });

  it("validates CONFIG_ENC_KEYS without echoing key material", () => {
    const good = `a:${randomBytes(32).toString("base64")},b:${randomBytes(32).toString("base64")}`;
    expect((parseKeyList(good) as Map<string, Buffer>).size).toBe(2);
    expect(parseKeyList(`a:${randomBytes(16).toString("base64")}`)).toMatch(/32 bytes/);
    const secret = randomBytes(32).toString("base64");
    const message = parseKeyList(secret) as string;
    expect(message).not.toContain(secret.slice(0, 6));
  });
});
