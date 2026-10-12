/**
 * PlutusShield-owned Lace / Midnight DApp Connector helpers.
 *
 * Patterns adapted from the public Lace Midnight connect guide and the
 * `@midnight-ntwrk/dapp-connector-api` 4.0.1 types. Do NOT hardcode
 * `window.midnight.mnLace` — wallets inject under a fresh UUID key each load;
 * always enumerate `window.midnight` and filter by apiVersion / rdns.
 *
 * Scope today: discover + connect + read addresses / service URIs.
 * Browser circuit submit (proveCover / fileClaim from the wallet) is next.
 *
 * Pure discovery / formatting / error helpers are injectable for Node tests.
 * Browser connect wraps the official InitialAPI.connect(networkId).
 */

import type {
  APIError,
  Configuration,
  ConnectedAPI,
  ConnectionStatus,
  ErrorCode,
  InitialAPI,
} from "@midnight-ntwrk/dapp-connector-api";
import { ErrorCodes } from "@midnight-ntwrk/dapp-connector-api";

export type { APIError, Configuration, ConnectedAPI, ConnectionStatus, ErrorCode, InitialAPI };
export { ErrorCodes };

/** Official Lace Midnight install / release notes. */
export const LACE_MIDNIGHT_INSTALL_URL = "https://docs.midnight.network/relnotes/lace";

/** Default apiVersion caret range matching DApp Connector 4.x (pin 4.0.1). */
export const DEFAULT_API_VERSION_RANGE = "^4.0.0";

export const MidnightNetworkIds = {
  Undeployed: "undeployed",
  Preview: "preview",
  Preprod: "preprod",
  Mainnet: "mainnet",
} as const;

export type MidnightNetworkId =
  | (typeof MidnightNetworkIds)[keyof typeof MidnightNetworkIds]
  | (string & {});

/** PlutusShield targets Midnight Preprod for the live product. */
export const PLUTUSSHIELD_MIDNIGHT_NETWORK: MidnightNetworkId = MidnightNetworkIds.Preprod;

export type SemVer = { major: number; minor: number; patch: number };

export function parseSemVer(raw: string): SemVer | null {
  const cleaned = raw.trim().replace(/^v/i, "");
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(cleaned);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * Satisfies a simple caret (`^x.y.z`) or exact (`x.y.z`) range.
 * Caret: same major, and >= the given minor.patch (semver caret for major ≥ 1).
 */
export function semverSatisfies(version: string, range: string): boolean {
  const v = parseSemVer(version);
  if (!v) return false;
  const trimmed = range.trim();
  if (trimmed.startsWith("^")) {
    const base = parseSemVer(trimmed.slice(1));
    if (!base) return false;
    if (v.major !== base.major) return false;
    if (v.minor > base.minor) return true;
    if (v.minor < base.minor) return false;
    return v.patch >= base.patch;
  }
  const exact = parseSemVer(trimmed);
  if (!exact) return false;
  return v.major === exact.major && v.minor === exact.minor && v.patch === exact.patch;
}

export type DiscoveredProvider = {
  /** UUID (or other) key under window.midnight — never assume "mnLace". */
  injectionKey: string;
  api: InitialAPI;
};

export type DiscoverOptions = {
  /** Semver range for InitialAPI.apiVersion. Default `^4.0.0`. Pass `*` / null to skip. */
  apiVersionRange?: string | null;
  /** If true, throw when duplicate rdns values appear among compatible wallets. */
  throwOnDuplicateRdns?: boolean;
};

export type DiscoverResult = {
  providers: DiscoveredProvider[];
  compatible: DiscoveredProvider[];
  hasDuplicateRdns: boolean;
  injectionKeys: string[];
};

function isInitialApi(v: unknown): v is InitialAPI {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as InitialAPI).connect === "function" &&
    typeof (v as InitialAPI).apiVersion === "string"
  );
}

/**
 * Enumerate Midnight wallets from an injected map (typically `window.midnight`).
 * Injectable for tests — pass a fake map; do not call with hardcoded mnLace.
 */
export function discoverProvidersFromMap(
  midnight: Record<string, unknown> | null | undefined,
  options: DiscoverOptions = {},
): DiscoverResult {
  if (!midnight) {
    return { providers: [], compatible: [], hasDuplicateRdns: false, injectionKeys: [] };
  }

  const injectionKeys = Object.keys(midnight);
  const providers: DiscoveredProvider[] = [];
  for (const key of injectionKeys) {
    const api = midnight[key];
    if (!isInitialApi(api)) continue;
    providers.push({ injectionKey: key, api });
  }

  const range = options.apiVersionRange === undefined ? DEFAULT_API_VERSION_RANGE : options.apiVersionRange;
  const compatible =
    range === null || range === "*"
      ? [...providers]
      : providers.filter((p) => semverSatisfies(p.api.apiVersion, range));

  const rdnsCounts = new Map<string, number>();
  for (const p of compatible) {
    const rdns = (p.api.rdns ?? "").trim().toLowerCase();
    if (!rdns) continue;
    rdnsCounts.set(rdns, (rdnsCounts.get(rdns) ?? 0) + 1);
  }
  const hasDuplicateRdns = [...rdnsCounts.values()].some((n) => n > 1);

  if (hasDuplicateRdns && options.throwOnDuplicateRdns) {
    throw new LaceMidnightError(
      KitErrorCodes.DuplicateRdns,
      "Multiple Midnight providers share the same rdns. Present choices to the user and warn about possible spoofing.",
      { recoverable: true },
    );
  }

  return { providers, compatible, hasDuplicateRdns, injectionKeys };
}

/** Browser convenience: read `window.midnight` (empty when not in a browser). */
export function discoverProviders(options: DiscoverOptions = {}): DiscoverResult {
  const midnight =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { window?: Window }).window !== "undefined"
      ? ((globalThis as { window: Window }).window as Window & { midnight?: Record<string, unknown> }).midnight
      : undefined;
  return discoverProvidersFromMap(midnight, options);
}

export function findProvider(
  selector: { injectionKey: string } | { rdns: string } | { preferRdnsIncludes?: string },
  midnight: Record<string, unknown> | null | undefined,
  options?: DiscoverOptions,
): DiscoveredProvider {
  const { compatible } = discoverProvidersFromMap(midnight, options);
  if (compatible.length === 0) {
    throw new LaceMidnightError(
      KitErrorCodes.NoProviders,
      "No Midnight wallet found. Install Lace with Midnight enabled and refresh. Do not hardcode window.midnight.mnLace.",
      { recoverable: true },
    );
  }
  if ("injectionKey" in selector) {
    const found = compatible.find((p) => p.injectionKey === selector.injectionKey);
    if (!found) {
      throw new LaceMidnightError(
        KitErrorCodes.ProviderNotFound,
        `No compatible provider with injectionKey=${selector.injectionKey}`,
        { recoverable: true },
      );
    }
    return found;
  }
  if ("rdns" in selector) {
    const target = selector.rdns.trim().toLowerCase();
    const found = compatible.find((p) => (p.api.rdns ?? "").trim().toLowerCase() === target);
    if (!found) {
      throw new LaceMidnightError(
        KitErrorCodes.ProviderNotFound,
        `No compatible provider with rdns=${selector.rdns}`,
        { recoverable: true },
      );
    }
    return found;
  }
  if (selector.preferRdnsIncludes) {
    const needle = selector.preferRdnsIncludes.toLowerCase();
    const preferred = compatible.find((p) => (p.api.rdns ?? "").toLowerCase().includes(needle));
    if (preferred) return preferred;
  }
  return compatible[0]!;
}

/** Sanitize wallet name for text display (never inject as HTML). */
export function safeWalletLabel(api: Pick<InitialAPI, "name">): string {
  // Strip tags and control chars so the label is safe as text (never inject as HTML).
  return String(api.name ?? "Unknown wallet")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001F<>]/g, "")
    .trim() || "Unknown wallet";
}

/** Only use as <img src="..."> — never insert into innerHTML. */
export function safeIconUrl(api: Pick<InitialAPI, "icon">): string | null {
  const icon = api.icon?.trim();
  if (!icon) return null;
  if (icon.startsWith("data:image/") || icon.startsWith("https://") || icon.startsWith("http://")) {
    return icon;
  }
  return null;
}

export function formatMidnightAddress(
  value: string | null | undefined,
  opts: { head?: number; tail?: number; placeholder?: string } = {},
): string {
  const placeholder = opts.placeholder ?? "(unavailable)";
  if (value == null || value === "") return placeholder;
  const head = opts.head ?? 10;
  const tail = opts.tail ?? 8;
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatInjectionKey(key: string, head = 8): string {
  if (!key) return "(none)";
  if (key.length <= head + 1) return key;
  return `${key.slice(0, head)}…`;
}

export type ServiceUriSummary = {
  networkId: string | null;
  indexerUri: string | null;
  indexerWsUri: string | null;
  proverServerUri: string | null;
  substrateNodeUri: string | null;
};

export function summarizeConfiguration(config: Configuration | null | undefined): ServiceUriSummary {
  if (!config) {
    return {
      networkId: null,
      indexerUri: null,
      indexerWsUri: null,
      proverServerUri: null,
      substrateNodeUri: null,
    };
  }
  return {
    networkId: config.networkId ?? null,
    indexerUri: config.indexerUri ?? null,
    indexerWsUri: config.indexerWsUri ?? null,
    proverServerUri: config.proverServerUri ?? null,
    substrateNodeUri: config.substrateNodeUri ?? null,
  };
}

export const KitErrorCodes = {
  NoWindow: "NoWindow",
  NoProviders: "NoProviders",
  ProviderNotFound: "ProviderNotFound",
  IncompatibleApiVersion: "IncompatibleApiVersion",
  DuplicateRdns: "DuplicateRdns",
  UserCancelled: "UserCancelled",
  ConnectionLost: "ConnectionLost",
  NetworkMismatch: "NetworkMismatch",
  WalletUnavailable: "WalletUnavailable",
  Unknown: "Unknown",
} as const;

export type KitErrorCode = (typeof KitErrorCodes)[keyof typeof KitErrorCodes] | ErrorCode;

export class LaceMidnightError extends Error {
  readonly code: KitErrorCode;
  readonly cause?: unknown;
  readonly recoverable: boolean;

  constructor(code: KitErrorCode, message: string, options?: { cause?: unknown; recoverable?: boolean }) {
    super(message);
    this.name = "LaceMidnightError";
    this.code = code;
    this.cause = options?.cause;
    this.recoverable = options?.recoverable ?? false;
  }
}

export function isAPIError(error: unknown): error is APIError {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    (error as { type: unknown }).type === "DAppConnectorAPIError" &&
    "code" in error &&
    "reason" in error
  );
}

export function isLaceMidnightError(error: unknown): error is LaceMidnightError {
  return error instanceof LaceMidnightError;
}

export function normalizeConnectorError(error: unknown): LaceMidnightError {
  if (isLaceMidnightError(error)) return error;
  if (isAPIError(error)) {
    const recoverable =
      error.code === ErrorCodes.Rejected ||
      error.code === ErrorCodes.PermissionRejected ||
      error.code === ErrorCodes.Disconnected;
    return new LaceMidnightError(error.code, error.reason || error.message, { cause: error, recoverable });
  }
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown wallet / connector error";
  const lower = message.toLowerCase();
  if (lower.includes("wallet is unavailable") || lower.includes("wallet unavailable")) {
    return new LaceMidnightError(KitErrorCodes.WalletUnavailable, message, { cause: error, recoverable: true });
  }
  if (lower.includes("user rejected") || lower.includes("rejected")) {
    return new LaceMidnightError(KitErrorCodes.UserCancelled, message, { cause: error, recoverable: true });
  }
  return new LaceMidnightError(KitErrorCodes.Unknown, message, { cause: error, recoverable: false });
}

export function userHintForError(error: LaceMidnightError): string {
  switch (error.code) {
    case KitErrorCodes.NoWindow:
      return "Lace Midnight only runs in a browser (it injects window.midnight).";
    case KitErrorCodes.NoProviders:
      return "No Midnight wallet found. Install Lace with Midnight enabled, then refresh.";
    case KitErrorCodes.IncompatibleApiVersion:
      return "Wallet API version is outside the range this DApp supports.";
    case KitErrorCodes.DuplicateRdns:
      return "Multiple wallets share the same rdns — choose carefully; one may be spoofed.";
    case KitErrorCodes.WalletUnavailable:
      return "Lace reported the wallet unavailable after connect. Wait for Preprod sync, restart the extension, then reconnect.";
    case KitErrorCodes.NetworkMismatch:
      return "Connected network id does not match Midnight Preprod.";
    case ErrorCodes.Rejected:
    case KitErrorCodes.UserCancelled:
      return "Connection or action was cancelled in the wallet.";
    case ErrorCodes.PermissionRejected:
      return "Wallet denied permission for this action for the session.";
    case ErrorCodes.Disconnected:
    case KitErrorCodes.ConnectionLost:
      return "Wallet connection was lost. Reconnect.";
    case ErrorCodes.InvalidRequest:
      return "Wallet rejected the request as invalid.";
    case ErrorCodes.InternalError:
      return "Wallet internal error. Check Lace sync / network status.";
    default:
      return error.message;
  }
}

export type ConnectedSession = {
  provider: DiscoveredProvider;
  api: ConnectedAPI;
  networkId: string;
  status: ConnectionStatus;
  configuration: Configuration | null;
  addresses: {
    unshieldedAddress: string | null;
    shieldedAddress: string | null;
    dustAddress: string | null;
  };
  services: ServiceUriSummary;
};

async function readAddressesSafely(api: ConnectedAPI): Promise<ConnectedSession["addresses"]> {
  const addresses: ConnectedSession["addresses"] = {
    unshieldedAddress: null,
    shieldedAddress: null,
    dustAddress: null,
  };
  try {
    const u = await api.getUnshieldedAddress();
    addresses.unshieldedAddress = u.unshieldedAddress;
  } catch (err) {
    const normalized = normalizeConnectorError(err);
    if (normalized.code === KitErrorCodes.WalletUnavailable) throw normalized;
  }
  try {
    const s = await api.getShieldedAddresses();
    addresses.shieldedAddress = s.shieldedAddress;
  } catch {
    /* optional for connect-only */
  }
  try {
    const d = await api.getDustAddress();
    addresses.dustAddress = d.dustAddress;
  } catch {
    /* optional */
  }
  return addresses;
}

export type ConnectWithProviderOptions = {
  networkId?: MidnightNetworkId;
  assertNetworkMatch?: boolean;
};

/**
 * Connect to a discovered Midnight provider via InitialAPI.connect(networkId).
 * Browser-only at the call site; does not submit circuits or transfers.
 */
export async function connectWithProvider(
  provider: DiscoveredProvider,
  options: ConnectWithProviderOptions = {},
): Promise<ConnectedSession> {
  const networkId = options.networkId ?? PLUTUSSHIELD_MIDNIGHT_NETWORK;
  const assertNetworkMatch = options.assertNetworkMatch !== false;

  let api: ConnectedAPI;
  try {
    api = await provider.api.connect(networkId);
  } catch (err) {
    throw normalizeConnectorError(err);
  }

  let status: ConnectionStatus;
  try {
    status = await api.getConnectionStatus();
  } catch (err) {
    throw normalizeConnectorError(err);
  }

  if (status.status === "disconnected") {
    throw new LaceMidnightError(KitErrorCodes.ConnectionLost, "Wallet reported disconnected immediately after connect.", {
      recoverable: true,
    });
  }

  if (assertNetworkMatch && status.status === "connected" && status.networkId !== networkId) {
    throw new LaceMidnightError(
      KitErrorCodes.NetworkMismatch,
      `Requested network "${networkId}" but wallet reports "${status.networkId}".`,
      { cause: status, recoverable: true },
    );
  }

  let configuration: Configuration | null = null;
  try {
    configuration = await api.getConfiguration();
  } catch {
    /* Lace may throw Wallet unavailable for getConfiguration — keep null */
  }

  const addresses = await readAddressesSafely(api);
  return {
    provider,
    api,
    networkId: status.status === "connected" ? status.networkId : String(networkId),
    status,
    configuration,
    addresses,
    services: summarizeConfiguration(configuration),
  };
}

export type ConnectMidnightOptions = DiscoverOptions &
  ConnectWithProviderOptions & {
    /** Which provider to use; required when multiple compatible wallets exist. */
    provider?: DiscoveredProvider | { injectionKey: string } | { rdns: string };
    /** Injected map; defaults to window.midnight in the browser. */
    midnight?: Record<string, unknown> | null;
  };

export async function connectMidnightWallet(options: ConnectMidnightOptions = {}): Promise<ConnectedSession> {
  const midnight =
    options.midnight !== undefined
      ? options.midnight
      : typeof globalThis !== "undefined" && typeof (globalThis as { window?: Window }).window !== "undefined"
        ? ((globalThis as { window: Window }).window as Window & { midnight?: Record<string, unknown> }).midnight
        : undefined;

  const discovery = discoverProvidersFromMap(midnight, options);
  if (discovery.compatible.length === 0) {
    throw new LaceMidnightError(
      KitErrorCodes.NoProviders,
      "No compatible Midnight wallet on window.midnight. Install Lace (Midnight), refresh, and enumerate providers — do not use window.midnight.mnLace.",
      { recoverable: true },
    );
  }

  let provider: DiscoveredProvider;
  if (options.provider && "api" in options.provider && "injectionKey" in options.provider) {
    provider = options.provider;
  } else if (options.provider && "injectionKey" in options.provider) {
    provider = findProvider({ injectionKey: options.provider.injectionKey }, midnight, options);
  } else if (options.provider && "rdns" in options.provider) {
    provider = findProvider({ rdns: options.provider.rdns }, midnight, options);
  } else if (discovery.compatible.length === 1) {
    provider = discovery.compatible[0]!;
  } else {
    throw new LaceMidnightError(
      KitErrorCodes.ProviderNotFound,
      `Multiple Midnight wallets found (${discovery.compatible.length}). Ask the user to choose, then call connectWithProvider.`,
      { recoverable: true },
    );
  }

  return connectWithProvider(provider, {
    networkId: options.networkId,
    assertNetworkMatch: options.assertNetworkMatch,
  });
}
