// Config type registry. Adding a type = one entry here + labels in
// messages/*.json (`vpn.types.<id>`) + instructions in content/instructions/.
// Everything else (file naming, import, download, VPN page) reads this list.

export type ValidationResult = { ok: true; content: string } | { ok: false; reason: string };

export interface ConfigTypeDef {
  id: string;
  /** Extensions accepted in file drops, lowercase with dot. */
  extensions: readonly string[];
  /** Extension and MIME type of the downloaded file. */
  downloadExtension: string;
  mimeType: string;
  /** Section order on the VPN page; lower comes first. */
  order: number;
  /** Legacy types are shown collapsed with a "will be retired" badge. */
  legacy: boolean;
  /** Content is a short link that can be shown, copied and rendered as a QR code. */
  revealable: boolean;
  /** Content sanity check; may normalize (trim, line endings). */
  validate(content: string): ValidationResult;
}

const MAX_TEXT_BYTES = 256 * 1024;

function asText(content: string): ValidationResult {
  if (Buffer.byteLength(content, "utf8") > MAX_TEXT_BYTES) return { ok: false, reason: "too_large" };
  if (content.includes("\u0000")) return { ok: false, reason: "binary_content" };
  if (!content.trim()) return { ok: false, reason: "empty" };
  return { ok: true, content: content.replace(/\r\n/g, "\n") };
}

// Accept canonical option names only. OpenVPN also accepts quoted names and
// escapes; refusing them (rather than partially parsing them) closes alternate
// spellings of executable directives. Unknown options fail closed.
const OVPN_ALLOWED = new Set(`
client dev dev-type proto remote remote-random remote-random-hostname
resolv-retry nobind persist-key persist-tun remote-cert-tls verify-x509-name
cipher data-ciphers data-ciphers-fallback auth auth-nocache auth-retry
reneg-sec tls-version-min tls-version-max tls-cipher tls-ciphersuites
key-direction verb mute mute-replay-warnings connect-retry connect-retry-max
connect-timeout server-poll-timeout hand-window ping ping-restart ping-exit keepalive
explicit-exit-notify sndbuf rcvbuf tun-mtu mssfix fragment fast-io
route route-ipv6 route-metric route-delay route-nopull redirect-gateway
redirect-private dhcp-option block-outside-dns pull pull-filter
comp-lzo compress allow-compression topology ifconfig ifconfig-ipv6
ifconfig-nowarn float remote-cert-eku remote-cert-ku tls-client
push-peer-info setenv auth-user-pass ca cert key tls-auth tls-crypt
tls-crypt-v2 extra-certs ignore-unknown-option
`.trim().split(/\s+/));
const OVPN_INLINE = new Set(["ca", "cert", "key", "tls-auth", "tls-crypt", "tls-crypt-v2", "extra-certs", "auth-user-pass"]);
const WG_FORBIDDEN = ["preup", "postup", "predown", "postdown"];

function forbiddenOvpnDirective(text: string): string | null {
  let block: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (block) {
      if (line === `</${block}>`) block = null;
      else if (line.startsWith("<")) return "invalid_inline_block";
      continue;
    }
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const open = /^<([a-z0-9-]+)>$/.exec(line);
    if (open) {
      if (!OVPN_INLINE.has(open[1]!)) return "unsupported_inline_block";
      block = open[1]!;
      continue;
    }
    const [word, ...args] = line.split(/\s+/);
    if (!word || !OVPN_ALLOWED.has(word)) return word ?? "invalid_directive";
    // Pritunl metadata only. In particular, never accept `setenv opt ...`,
    // which OpenVPN interprets as another option rather than metadata.
    if (word === "setenv" && !/^UV_[A-Za-z0-9_]+$/.test(args[0] ?? "")) return word;
    if (word === "ignore-unknown-option" &&
        (args.length === 0 || args.some((arg) => !OVPN_ALLOWED.has(arg) || arg === word))) return word;
    // Never read credentials or keys from arbitrary paths on the client.
    if (OVPN_INLINE.has(word) && !(args.length === 1 && args[0] === "[inline]") &&
        !(word === "auth-user-pass" && args.length === 0)) return word;
  }
  return block ? "unterminated_inline_block" : null;
}

function forbiddenWgDirective(text: string): string | null {
  for (const raw of text.split("\n")) {
    const key = raw.split("=")[0]!.trim().toLowerCase();
    if (WG_FORBIDDEN.includes(key)) return key;
  }
  return null;
}

const pritunl: ConfigTypeDef = {
  id: "pritunl",
  extensions: [".ovpn", ".tar"],
  downloadExtension: ".ovpn",
  mimeType: "application/x-openvpn-profile",
  order: 10,
  legacy: false,
  revealable: false,
  validate(raw) {
    const text = asText(raw);
    if (!text.ok) return text;
    if (!/^\s*client\s*$/m.test(text.content)) return { ok: false, reason: "ovpn_missing_client" };
    if (!/^\s*remote\s+\S+/m.test(text.content)) return { ok: false, reason: "ovpn_missing_remote" };
    if (forbiddenOvpnDirective(text.content)) return { ok: false, reason: "ovpn_forbidden_directive" };
    return text;
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateVlessUri(line: string): ValidationResult {
  if (!line.toLowerCase().startsWith("vless://")) return { ok: false, reason: "vless_not_a_link" };
  let url: URL;
  try {
    url = new URL(line);
  } catch {
    return { ok: false, reason: "vless_malformed" };
  }
  if (url.protocol !== "vless:") return { ok: false, reason: "vless_not_a_link" };
  try {
    if (!UUID.test(decodeURIComponent(url.username))) return { ok: false, reason: "vless_bad_uuid" };
  } catch {
    return { ok: false, reason: "vless_bad_uuid" };
  }
  if (!url.hostname) return { ok: false, reason: "vless_missing_host" };
  const port = Number(url.port);
  if (!url.port || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, reason: "vless_bad_port" };
  }
  return { ok: true, content: line };
}

const vless: ConfigTypeDef = {
  id: "vless",
  extensions: [".txt"],
  downloadExtension: ".txt",
  mimeType: "text/plain; charset=utf-8",
  order: 20,
  legacy: false,
  revealable: true,
  validate(raw) {
    const text = asText(raw);
    if (!text.ok) return text;
    const lines = text.content.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length !== 1) return { ok: false, reason: "vless_expected_one_link" };
    const link = validateVlessUri(lines[0]!);
    return link.ok ? { ok: true, content: `${link.content}\n` } : link;
  },
};

const wireguard: ConfigTypeDef = {
  id: "wg",
  extensions: [".conf"],
  downloadExtension: ".conf",
  mimeType: "text/plain; charset=utf-8",
  order: 30,
  legacy: true,
  revealable: false,
  validate(raw) {
    const text = asText(raw);
    if (!text.ok) return text;
    if (!/^\s*\[Interface\]\s*$/im.test(text.content)) return { ok: false, reason: "wg_missing_interface" };
    if (!/^\s*\[Peer\]\s*$/im.test(text.content)) return { ok: false, reason: "wg_missing_peer" };
    if (!/^\s*PrivateKey\s*=\s*\S+/im.test(text.content)) return { ok: false, reason: "wg_missing_private_key" };
    if (forbiddenWgDirective(text.content)) return { ok: false, reason: "wg_forbidden_directive" };
    return text;
  },
};

export const CONFIG_TYPES: readonly ConfigTypeDef[] = [pritunl, vless, wireguard].sort(
  (a, b) => a.order - b.order,
);

export function getConfigType(id: string): ConfigTypeDef | undefined {
  return CONFIG_TYPES.find((t) => t.id === id);
}
