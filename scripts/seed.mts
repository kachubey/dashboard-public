// Development seed: mock users, their owner aliases, and sample configs of
// every type imported through the real pipeline (plus a pending config and two
// quarantined files). Deterministic, so running it twice changes nothing.
import { createHash } from "node:crypto";
import { MOCK_USERS } from "../src/server/auth/mock-users";
import { upsertDirectoryUser } from "../src/server/auth/users";
import { env } from "../src/server/env";
import { db, schema } from "../src/server/db";
import type { InputFile } from "../src/server/vpn/import/inputs";
import { commitImport } from "../src/server/vpn/import/pipeline";
import { linkAliasesOnSignIn } from "../src/server/vpn/owners";

if (env().isProduction) {
  console.error("Refusing to seed a production database.");
  process.exit(1);
}

// Demo restarts keep the user's work. Explicit seeding still restores samples.
if (process.argv.includes("--if-empty") && (await db.select({ id: schema.user.id }).from(schema.user).limit(1)).length) {
  console.log("Demo already initialized; existing data kept.");
  process.exit(0);
}

const h = (s: string) => createHash("sha256").update(`portal-seed:${s}`).digest();
const b64 = (s: string) => h(s).toString("base64");
const uuidOf = (s: string) => {
  const x = h(s).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-4${x.slice(13, 16)}-8${x.slice(17, 20)}-${x.slice(20, 32)}`;
};

const ovpn = (owner: string, server: string) => `# SAMPLE — not a working profile
client
dev tun
proto udp
remote ${server}.vpn.example.test 1194
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
cipher AES-256-GCM
verb 3
<ca>
-----BEGIN CERTIFICATE-----
SAMPLE-CA-${b64(`ca-${server}`)}
-----END CERTIFICATE-----
</ca>
<cert>
-----BEGIN CERTIFICATE-----
SAMPLE-CERT-${b64(`cert-${owner}-${server}`)}
-----END CERTIFICATE-----
</cert>
<key>
-----BEGIN PRIVATE KEY-----
SAMPLE-KEY-${b64(`key-${owner}-${server}`)}
-----END PRIVATE KEY-----
</key>
`;

const vless = (owner: string, node: string) =>
  `vless://${uuidOf(`vless-${owner}-${node}`)}@${node}.example.test:443?type=tcp&security=reality&sni=www.example.com&fp=firefox&pbk=${h(`pbk-${node}`).toString("base64url").slice(0, 43)}&sid=${h(`sid-${node}`).toString("hex").slice(0, 8)}&flow=xtls-rprx-vision#${owner}-${node}\n`;

const wg = (owner: string, site: string) => `# SAMPLE — not a working tunnel
[Interface]
PrivateKey = ${b64(`wg-priv-${owner}-${site}`)}
Address = 10.20.0.${(h(owner)[0]! % 200) + 10}/32
DNS = 10.20.0.1

[Peer]
PublicKey = ${b64(`wg-pub-${site}`)}
AllowedIPs = 10.0.0.0/8
Endpoint = ${site}.vpn.example.test:51820
PersistentKeepalive = 25
`;

const file = (name: string, content: string): InputFile => ({ name, bytes: Buffer.from(content, "utf8") });

for (const u of MOCK_USERS) {
  const row = await upsertDirectoryUser({ ...u, employeeId: u.employeeId ?? null });
  // Normally done at first sign-in; done here so the sample configs show as matched.
  if (u.roles.length) await linkAliasesOnSignIn(row);
  console.log(`user  ${u.upn.padEnd(24)} ${u.roles.join(", ") || "(no role)"}`);
}

const files: InputFile[] = [
  file("alice__pritunl__main.ovpn", ovpn("alice", "main")),
  file("alice__vless__nl-1.txt", vless("alice", "nl-1")),
  file("alice__vless__de-1.txt", vless("alice", "de-1")),
  file("alice__wg__office-a.conf", wg("alice", "office-a")),
  file("bob__pritunl__main.ovpn", ovpn("bob", "main")),
  file("bob__vless__nl-1.txt", vless("bob", "nl-1")),
  file("admin__pritunl__main.ovpn", ovpn("admin", "main")),
  // Nobody with this key has signed in yet → "waiting for owner".
  file("newhire__pritunl__main.ovpn", ovpn("newhire", "main")),
  // Two broken files → quarantine.
  file("alice-backup.ovpn", ovpn("alice", "backup")),
  file("bob__wg__home.conf", "[Interface]\nAddress = 10.20.0.99/32\n"),
];

const result = await commitImport(files, { oid: null, upn: "seed" }, "seed");
const s = result.summary;
console.log(`configs: ${s.create} created, ${s.replace} replaced, ${s.unchanged} unchanged, ${s.quarantine} quarantined, ${s.pending} waiting for owner`);
process.exit(0);
