// Re-encrypt every row that isn't sealed with the active key.
//
// Rotation procedure:
//   1. generate a key:   npm run keys:generate
//   2. append it to CONFIG_ENC_KEYS and set CONFIG_ENC_ACTIVE_KEY_ID to its id
//   3. restart the app (new data uses the new key from now on)
//   4. npm run keys:rotate            (re-encrypts the old rows)
//   5. once it reports 0 remaining, remove the old key from CONFIG_ENC_KEYS
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { aad, keyProvider, open, seal } from "../src/server/crypto";
import { db, schema } from "../src/server/db";

const dryRun = process.argv.includes("--dry-run");
const active = keyProvider().activeKeyId();
let rotated = 0;

const versions = await db
  .select({ id: schema.vpnConfigVersions.id, configId: schema.vpnConfigVersions.configId, keyId: schema.vpnConfigVersions.keyId, iv: schema.vpnConfigVersions.iv, ciphertext: schema.vpnConfigVersions.ciphertext })
  .from(schema.vpnConfigVersions)
  .where(ne(schema.vpnConfigVersions.keyId, active));
const quarantined = await db
  .select({ id: schema.quarantineItems.id, keyId: schema.quarantineItems.keyId, iv: schema.quarantineItems.iv, ciphertext: schema.quarantineItems.ciphertext })
  .from(schema.quarantineItems)
  .where(and(isNotNull(schema.quarantineItems.keyId), ne(schema.quarantineItems.keyId, active)));

console.log(`active key: ${active}; to re-encrypt: ${versions.length} config versions, ${quarantined.length} quarantined files`);
if (dryRun) process.exit(0);

for (const row of versions) {
  const plain = await open({ keyId: row.keyId, iv: row.iv, ciphertext: row.ciphertext }, aad.configVersion(row.configId, row.id));
  const sealed = await seal(plain, aad.configVersion(row.configId, row.id));
  await db.update(schema.vpnConfigVersions).set(sealed).where(eq(schema.vpnConfigVersions.id, row.id));
  rotated += 1;
}
for (const row of quarantined) {
  const plain = await open({ keyId: row.keyId!, iv: row.iv!, ciphertext: row.ciphertext! }, aad.quarantine(row.id));
  const sealed = await seal(plain, aad.quarantine(row.id));
  await db.update(schema.quarantineItems).set(sealed).where(eq(schema.quarantineItems.id, row.id));
  rotated += 1;
}
console.log(`re-encrypted ${rotated} rows with key "${active}". Old keys can be removed once no rows use them.`);
process.exit(0);
