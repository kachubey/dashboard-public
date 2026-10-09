import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env";

// AES-256-GCM encryption at rest for config contents.
//
// Every encrypted row stores the id of the key it was sealed with, so keys can
// be rotated: add a new key, make it active, run `npm run keys:rotate`, then
// drop the old key. Keys come from a KeyProvider; today that's the environment,
// later it can be Azure Key Vault or another KMS without touching callers.
//
// The AAD (additional authenticated data) binds a ciphertext to the row it
// belongs to, so swapping ciphertexts between rows in the database makes
// decryption fail instead of handing one user another user's config.

export interface KeyProvider {
  activeKeyId(): string;
  getKey(id: string): Promise<Buffer>;
}

export class EnvKeyProvider implements KeyProvider {
  constructor(
    private readonly keys: Map<string, Buffer>,
    private readonly activeId: string,
  ) {}

  activeKeyId(): string {
    return this.activeId;
  }

  async getKey(id: string): Promise<Buffer> {
    const key = this.keys.get(id);
    if (!key) throw new CryptoError(`Unknown encryption key id "${id}"`);
    return key;
  }
}

export class CryptoError extends Error {
  override name = "CryptoError";
}

export interface Sealed {
  keyId: string;
  /** 12-byte GCM nonce, random per encryption. */
  iv: Buffer;
  /** Ciphertext followed by the 16-byte GCM tag. */
  ciphertext: Buffer;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

let provider: KeyProvider | undefined;

export function keyProvider(): KeyProvider {
  provider ??= new EnvKeyProvider(env().encryptionKeys, env().CONFIG_ENC_ACTIVE_KEY_ID);
  return provider;
}

/** For tests and the rotation script. */
export function setKeyProvider(p: KeyProvider): void {
  provider = p;
}

export async function seal(plaintext: Buffer, aad: string, kp: KeyProvider = keyProvider()): Promise<Sealed> {
  const keyId = kp.activeKeyId();
  const key = await kp.getKey(keyId);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { keyId, iv, ciphertext: Buffer.concat([body, cipher.getAuthTag()]) };
}

export async function open(sealed: Sealed, aad: string, kp: KeyProvider = keyProvider()): Promise<Buffer> {
  if (sealed.iv.length !== IV_BYTES || sealed.ciphertext.length < TAG_BYTES) {
    throw new CryptoError("Malformed ciphertext");
  }
  const key = await kp.getKey(sealed.keyId);
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(sealed.ciphertext.subarray(sealed.ciphertext.length - TAG_BYTES));
  try {
    return Buffer.concat([
      decipher.update(sealed.ciphertext.subarray(0, sealed.ciphertext.length - TAG_BYTES)),
      decipher.final(),
    ]);
  } catch {
    // Deliberately vague: never include data that could help an attacker.
    throw new CryptoError("Decryption failed (wrong key, tampered data or wrong row)");
  }
}

/** AAD for a config version and for a quarantined file. */
export const aad = {
  // Bound to both the config and the version: a version row moved to another
  // config (or a ciphertext pasted into another row) fails to decrypt.
  configVersion: (configId: string, versionId: string) => `vpn-config-version:v2:${configId}:${versionId}`,
  quarantine: (itemId: string) => `quarantine-item:${itemId}`,
};
