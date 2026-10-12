/**
 * Pure fetch-based ZK config loader for browser / static Pages.
 *
 * Matches the NodeZkConfigProvider on-disk layout used by midnight-js:
 *   {baseUrl}/keys/{circuitId}.prover
 *   {baseUrl}/keys/{circuitId}.verifier
 *   {baseUrl}/zkir/{circuitId}.zkir
 *
 * No midnight-js dependency — injectable `fetch` for tests. Prover keys are
 * large (~3MB each) and are typically served only in local/dev; verifier +
 * zkir are small and ship on GitHub Pages for readiness probes.
 */

/** Relative path under the web public/ tree for Preprod policy-cover-v2 assets. */
export const DEFAULT_ZK_ASSET_BASE = "zk/policy-cover-v2";

/** Circuits the browser Lace path probes by default. */
export const DEFAULT_ZK_CIRCUIT_IDS = ["fileClaim", "proveCover"] as const;

export type ZkCircuitId = string;

export type ZkConfigBytes = {
  proverKey: Uint8Array;
  verifierKey: Uint8Array;
  zkir: Uint8Array;
};

export type ZkAssetKind = "prover" | "verifier" | "zkir";

export type ZkAssetProbeItem = {
  circuitId: string;
  kind: ZkAssetKind;
  url: string;
  ok: boolean;
  status: number | null;
  size: number | null;
  detail: string;
};

export type ZkCircuitProbe = {
  circuitId: string;
  /** True when verifier + zkir are both reachable (prover optional). */
  ok: boolean;
  /** True when the large prover key is also reachable. */
  proverOk: boolean;
  assets: ZkAssetProbeItem[];
  detail: string;
};

export type ProbeZkAssetsResult = {
  baseUrl: string;
  circuits: ZkCircuitProbe[];
  /** True when every requested circuit has verifier + zkir. */
  ok: boolean;
  detail: string;
};

export type FetchZkConfigErrorCode =
  | "missing-asset"
  | "http-error"
  | "network-error"
  | "empty-body";

export class FetchZkConfigError extends Error {
  readonly code: FetchZkConfigErrorCode;
  readonly circuitId: string;
  readonly kind: ZkAssetKind;
  readonly url: string;
  readonly status: number | null;

  constructor(
    code: FetchZkConfigErrorCode,
    message: string,
    opts: { circuitId: string; kind: ZkAssetKind; url: string; status?: number | null },
  ) {
    super(message);
    this.name = "FetchZkConfigError";
    this.code = code;
    this.circuitId = opts.circuitId;
    this.kind = opts.kind;
    this.url = opts.url;
    this.status = opts.status ?? null;
  }
}

export function isFetchZkConfigError(e: unknown): e is FetchZkConfigError {
  return e instanceof FetchZkConfigError;
}

/** Join baseUrl + relative path without double slashes. */
export function joinZkAssetUrl(baseUrl: string, ...parts: string[]): string {
  const base = baseUrl.replace(/\/+$/, "");
  const rest = parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  if (!base) return `/${rest}`;
  return `${base}/${rest}`;
}

export function zkAssetPaths(circuitId: string): Record<ZkAssetKind, string> {
  return {
    prover: `keys/${circuitId}.prover`,
    verifier: `keys/${circuitId}.verifier`,
    zkir: `zkir/${circuitId}.zkir`,
  };
}

async function readBytes(
  res: Response,
  circuitId: string,
  kind: ZkAssetKind,
  url: string,
): Promise<Uint8Array> {
  if (!res.ok) {
    throw new FetchZkConfigError(
      res.status === 404 ? "missing-asset" : "http-error",
      `ZK ${kind} for ${circuitId}: HTTP ${res.status} from ${url}`,
      { circuitId, kind, url, status: res.status },
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0) {
    throw new FetchZkConfigError("empty-body", `ZK ${kind} for ${circuitId} is empty at ${url}`, {
      circuitId,
      kind,
      url,
      status: res.status,
    });
  }
  return buf;
}

/**
 * Fetch prover + verifier + zkir for one circuit. Throws FetchZkConfigError on
 * any missing or empty asset (including the large prover key).
 */
export async function fetchZkConfig(
  baseUrl: string,
  circuitId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ZkConfigBytes> {
  const paths = zkAssetPaths(circuitId);
  const load = async (kind: ZkAssetKind): Promise<Uint8Array> => {
    const url = joinZkAssetUrl(baseUrl, paths[kind]);
    try {
      const res = await fetchImpl(url, { method: "GET", mode: "cors" });
      return await readBytes(res, circuitId, kind, url);
    } catch (e) {
      if (e instanceof FetchZkConfigError) throw e;
      throw new FetchZkConfigError(
        "network-error",
        `ZK ${kind} for ${circuitId}: ${e instanceof Error ? e.message : String(e)}`,
        { circuitId, kind, url },
      );
    }
  };
  const [proverKey, verifierKey, zkir] = await Promise.all([
    load("prover"),
    load("verifier"),
    load("zkir"),
  ]);
  return { proverKey, verifierKey, zkir };
}

async function probeOne(
  baseUrl: string,
  circuitId: string,
  kind: ZkAssetKind,
  fetchImpl: typeof fetch,
): Promise<ZkAssetProbeItem> {
  const url = joinZkAssetUrl(baseUrl, zkAssetPaths(circuitId)[kind]);
  try {
    // Prefer HEAD; fall back to GET if the host rejects HEAD.
    let res = await fetchImpl(url, { method: "HEAD", mode: "cors" });
    if (res.status === 405 || res.status === 501) {
      res = await fetchImpl(url, { method: "GET", mode: "cors" });
    }
    const sizeHeader = res.headers.get("content-length");
    let size = sizeHeader && /^\d+$/.test(sizeHeader) ? Number(sizeHeader) : null;
    if (size == null && res.ok && res.body) {
      try {
        const buf = new Uint8Array(await res.arrayBuffer());
        size = buf.byteLength;
      } catch {
        size = null;
      }
    }
    if (res.ok && (size === null || size > 0)) {
      return {
        circuitId,
        kind,
        url,
        ok: true,
        status: res.status,
        size,
        detail: size != null ? `${kind} ok (${size} bytes)` : `${kind} ok`,
      };
    }
    if (res.ok && size === 0) {
      return {
        circuitId,
        kind,
        url,
        ok: false,
        status: res.status,
        size: 0,
        detail: `${kind} empty at ${url}`,
      };
    }
    return {
      circuitId,
      kind,
      url,
      ok: false,
      status: res.status,
      size,
      detail: `HTTP ${res.status} for ${kind}`,
    };
  } catch (e) {
    return {
      circuitId,
      kind,
      url,
      ok: false,
      status: null,
      size: null,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Probe verifier + zkir (required) and prover (optional) for each circuit.
 * Never throws.
 */
export async function probeZkAssets(
  baseUrl: string,
  circuitIds: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeZkAssetsResult> {
  const circuits: ZkCircuitProbe[] = [];
  for (const circuitId of circuitIds) {
    const assets = await Promise.all([
      probeOne(baseUrl, circuitId, "verifier", fetchImpl),
      probeOne(baseUrl, circuitId, "zkir", fetchImpl),
      probeOne(baseUrl, circuitId, "prover", fetchImpl),
    ]);
    const verifierOk = assets[0]?.ok === true;
    const zkirOk = assets[1]?.ok === true;
    const proverOk = assets[2]?.ok === true;
    const ok = verifierOk && zkirOk;
    let detail: string;
    if (ok && proverOk) {
      detail = `${circuitId}: verifier + zkir + prover present`;
    } else if (ok) {
      detail = `${circuitId}: verifier + zkir present (prover key local/dev only — ~3MB, not on Pages)`;
    } else {
      const missing = assets
        .filter((a) => a.kind !== "prover" && !a.ok)
        .map((a) => a.kind)
        .join(", ");
      detail = `${circuitId}: missing ${missing || "required assets"}`;
    }
    circuits.push({ circuitId, ok, proverOk, assets, detail });
  }
  const ok = circuits.length > 0 && circuits.every((c) => c.ok);
  const detail = ok
    ? `ZK assets ready at ${baseUrl} (${circuits.map((c) => c.circuitId).join(", ")})`
    : circuits.length === 0
      ? "No circuits probed"
      : `ZK assets incomplete: ${circuits
          .filter((c) => !c.ok)
          .map((c) => c.circuitId)
          .join(", ")}`;
  return { baseUrl, circuits, ok, detail };
}

/**
 * Summarize a probe for assessCircuitSubmitReadiness({ zkAssets }).
 */
export function zkAssetsReadinessSummary(
  probe: ProbeZkAssetsResult | null | undefined,
): { ok: boolean; detail: string } | null {
  if (!probe) return null;
  return { ok: probe.ok, detail: probe.detail };
}
