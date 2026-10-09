import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { listConfigsForUser, type UserConfigSummary } from "./repository";

// Where configs come from. Today every config is created by hand and imported
// (ManualImportProvider). Later, configs can be issued automatically by the
// VPN servers themselves — the portal code that lists and serves configs
// doesn't change, only a new provider is added here.

export interface ProviderUser {
  id: string;
  oid: string;
  upn: string;
  shortUpn: string;
}

export interface IssueRequest {
  type: string;
  label: string;
}

export interface ConfigProvider {
  readonly id: string;
  /** Config types this provider can serve. */
  readonly types: readonly string[];
  listForUser(user: ProviderUser): Promise<UserConfigSummary[]>;
  /** Create a new config for the user on the VPN server and store it. */
  issueForUser(user: ProviderUser, request: IssueRequest): Promise<UserConfigSummary>;
  /** Revoke the user's config on the VPN server and deactivate it here. */
  revokeForUser(user: ProviderUser, configId: string): Promise<void>;
}

export class NotSupportedError extends Error {
  override name = "NotSupportedError";
}

/** Configs exported by an admin and imported from files. */
export class ManualImportProvider implements ConfigProvider {
  readonly id = "manual";
  readonly types = ["pritunl", "vless", "wg"] as const;

  listForUser(user: ProviderUser) {
    return listConfigsForUser(user.id);
  }

  async issueForUser(): Promise<UserConfigSummary> {
    throw new NotSupportedError("Manual configs are created by an admin and imported");
  }

  async revokeForUser(_user: ProviderUser, configId: string): Promise<void> {
    // Nothing to revoke on a server we don't control — just stop serving it.
    await db
      .update(schema.vpnConfigs)
      .set({ status: "deactivated" })
      .where(and(eq(schema.vpnConfigs.id, configId), eq(schema.vpnConfigs.status, "active")));
  }
}

/**
 * Pritunl server API (https://docs.pritunl.com/docs/api).
 * TODO: issueForUser — create/find the user in the organization, download the
 *   profile (.tar/.ovpn), store it as a new version via the import pipeline.
 * TODO: revokeForUser — disable the Pritunl user, then deactivate locally.
 * TODO: config: PRITUNL_API_URL, PRITUNL_API_TOKEN, PRITUNL_API_SECRET, PRITUNL_ORG_ID.
 */
export class PritunlApiProvider implements ConfigProvider {
  readonly id = "pritunl-api";
  readonly types = ["pritunl"] as const;
  listForUser(user: ProviderUser) {
    return listConfigsForUser(user.id).then((all) => all.filter((x) => x.type === "pritunl"));
  }
  async issueForUser(): Promise<UserConfigSummary> {
    throw new NotSupportedError("PritunlApiProvider is not implemented yet");
  }
  async revokeForUser(): Promise<void> {
    throw new NotSupportedError("PritunlApiProvider is not implemented yet");
  }
}

/**
 * 3x-ui panel API (Xray/VLESS).
 * TODO: issueForUser — add a client (uuid, email = shortUpn) to the inbound,
 *   build the vless:// link from the inbound settings, store it as a version.
 * TODO: revokeForUser — disable/delete the client in the inbound.
 * TODO: the panel must stay unreachable from the internet; call it over a
 *   private network or SSH tunnel. Config: XUI_API_URL, XUI_USERNAME,
 *   XUI_PASSWORD, XUI_INBOUND_IDS.
 */
export class XuiApiProvider implements ConfigProvider {
  readonly id = "3x-ui-api";
  readonly types = ["vless"] as const;
  listForUser(user: ProviderUser) {
    return listConfigsForUser(user.id).then((all) => all.filter((x) => x.type === "vless"));
  }
  async issueForUser(): Promise<UserConfigSummary> {
    throw new NotSupportedError("XuiApiProvider is not implemented yet");
  }
  async revokeForUser(): Promise<void> {
    throw new NotSupportedError("XuiApiProvider is not implemented yet");
  }
}

/** The providers in use. Add automated providers here when they exist. */
export function activeProviders(): ConfigProvider[] {
  return [new ManualImportProvider()];
}

export async function listAllConfigsForUser(user: ProviderUser): Promise<UserConfigSummary[]> {
  const lists = await Promise.all(activeProviders().map((p) => p.listForUser(user)));
  const byId = new Map(lists.flat().map((x) => [x.id, x]));
  return [...byId.values()];
}
