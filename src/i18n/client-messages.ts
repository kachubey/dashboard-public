import { getMessages } from "next-intl/server";

// Only these namespaces are used by client components; everything else is
// rendered on the server and never needs to reach the browser.
const BASE = ["app", "modules", "header", "vpn"] as const;

export async function clientMessages(extra: readonly string[] = []) {
  const all = (await getMessages()) as Record<string, unknown>;
  return Object.fromEntries([...BASE, ...extra].filter((k) => k in all).map((k) => [k, all[k]]));
}
