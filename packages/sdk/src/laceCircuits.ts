/**
 * Lace / Midnight DApp Connector circuit submit helpers for proveCover and
 * fileClaim.
 *
 * Connect (discover + addresses + service URIs) landed in lace.ts. This module
 * is the next slice: resolve how proving happens on the connected wallet
 * (delegated getProvingProvider vs Lace HTTP proverServerUri fallback), hint
 * the connector methods a circuit call needs, prepare the exact circuit args
 * from a policy key + sealed evidence, balance + submit a proven unsealed tx
 * string through ConnectedAPI, and orchestrate a browser fileClaim / proveCover
 * when a BrowserCircuitProver is injected.
 *
 * Building the unproven Compact call still needs midnight-js (CompiledContract
 * + witnesses + ZK configs). That prover is injectable so Node tests and the
 * static Pages shell stay light; the claim kit CLI remains the proven filer
 * until a browser prover is wired.
 *
 * Lace today often omits getProvingProvider — see Midnight forum thread on the
 * Lace gap; fall back to configuration.proverServerUri + HTTP proof server.
 */

import type { Configuration, ConnectedAPI, WalletConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { checkPolicyKey, holderPrivateState, type PolicyKey } from "./midnight.ts";
import {
  ErrorCodes,
  KitErrorCodes,
  LaceMidnightError,
  normalizeConnectorError,
  summarizeConfiguration,
  type ServiceUriSummary,
} from "./lace.ts";

const HEX32 = /^[0-9a-f]{64}$/;

/** Circuits on policy-cover / policy-cover-v2 the browser intends to call. */
export const BrowserCircuits = {
  proveCover: "proveCover",
  fileClaim: "fileClaim",
} as const;

export type BrowserCircuitId = (typeof BrowserCircuits)[keyof typeof BrowserCircuits];

/** Live Preprod v2 registry (contracts/midnight/deployments/preprod-v2.json). */
export const PREPROD_V2_CONTRACT_ADDRESS =
  "5430b803b6b3df6e6ee1d498bb02e2f2d06cb46661e72af1e6208d864feb8110";

/** Default local proof server when Lace config omits proverServerUri. */
export const DEFAULT_PROOF_SERVER_URI = "http://127.0.0.1:6300";

/**
 * ConnectedAPI methods a circuit submit path asks Lace to permission via
 * hintUsage before balance + submit.
 */
export const CIRCUIT_SUBMIT_HINT_METHODS = [
  "getConfiguration",
  "getConnectionStatus",
  "balanceUnsealedTransaction",
  "submitTransaction",
] as const satisfies ReadonlyArray<keyof WalletConnectedAPI>;

export const FILE_CLAIM_HINT_METHODS = CIRCUIT_SUBMIT_HINT_METHODS;
export const PROVE_COVER_HINT_METHODS = CIRCUIT_SUBMIT_HINT_METHODS;

export type ProvingStrategyKind = "delegated" | "http" | "unavailable";

export type ProvingStrategy =
  | {
      kind: "delegated";
      /** Wallet exposes getProvingProvider (e.g. 1AM). */
      detail: string;
    }
  | {
      kind: "http";
      /** Lace (and similar) — prove via HTTP proof server. */
      proverServerUri: string;
      source: "lace-config" | "fallback-default";
      detail: string;
    }
  | {
      kind: "unavailable";
      detail: string;
    };

/**
 * Pick how this connected wallet will prove. Prefer getProvingProvider when
 * present; otherwise use Lace's (deprecated-but-live) proverServerUri, then
 * the local default.
 */
export function resolveProvingStrategy(
  api: Pick<ConnectedAPI, "getProvingProvider"> | null | undefined,
  configuration: Configuration | ServiceUriSummary | null | undefined,
): ProvingStrategy {
  if (api && typeof (api as ConnectedAPI).getProvingProvider === "function") {
    return {
      kind: "delegated",
      detail: "Wallet exposes getProvingProvider — prove inside the wallet with ZK configs the DApp supplies.",
    };
  }
  const fromConfig =
    configuration && "proverServerUri" in configuration
      ? (configuration.proverServerUri ?? null)
      : null;
  if (fromConfig && /^https?:\/\//i.test(fromConfig)) {
    return {
      kind: "http",
      proverServerUri: fromConfig.replace(/\/$/, ""),
      source: "lace-config",
      detail: "Lace has no getProvingProvider yet; use getConfiguration().proverServerUri with an HTTP proof server.",
    };
  }
  return {
    kind: "http",
    proverServerUri: DEFAULT_PROOF_SERVER_URI,
    source: "fallback-default",
    detail:
      "No wallet prover and no Lace proverServerUri — defaulting to a local proof server at 127.0.0.1:6300 (run one, or set Lace's proof server URI).",
  };
}

export type ProverHealth = {
  ok: boolean;
  uri: string;
  status: number | null;
  detail: string;
};

/**
 * GET {uri}/health (or the uri itself). Injectable fetch for tests.
 * Never throws — returns ok:false on network / non-2xx.
 */
export async function probeProverHealth(
  uri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProverHealth> {
  const base = uri.replace(/\/$/, "");
  const candidates = [`${base}/health`, base];
  let lastDetail = "No response";
  let lastStatus: number | null = null;
  for (const url of candidates) {
    try {
      const res = await fetchImpl(url, { method: "GET", mode: "cors" });
      lastStatus = res.status;
      if (res.ok) {
        return { ok: true, uri: base, status: res.status, detail: `Proof server healthy at ${url}` };
      }
      lastDetail = `HTTP ${res.status} from ${url}`;
    } catch (e) {
      lastDetail = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, uri: base, status: lastStatus, detail: lastDetail };
}

export type FileClaimCall = {
  circuit: typeof BrowserCircuits.fileClaim;
  policyId: string;
  evidenceCommitment: string;
  contractAddress: string;
  network: "preprod";
  /** Private state shape midnight-js witnesses expect for this holder. */
  privateState: ReturnType<typeof holderPrivateState>;
};

export type ProveCoverCall = {
  circuit: typeof BrowserCircuits.proveCover;
  policyId: string;
  /** Decimal string Uint<64> coverage the holder proves at least. */
  minCoverage: string;
  contractAddress: string;
  network: "preprod";
  privateState: ReturnType<typeof holderPrivateState>;
};

export type PrepareFileClaimArgs = {
  key: PolicyKey;
  evidenceCommitment: string;
  contractAddress?: string;
  /** Optional Cardano datum midnight_commitment to re-check the key against. */
  datumCommitment?: string;
};

/** Build a validated fileClaim call from a policy key + evidence commitment. */
export async function prepareFileClaimCall(a: PrepareFileClaimArgs): Promise<FileClaimCall> {
  const policyId = a.key.policyId.toLowerCase();
  const evidenceCommitment = a.evidenceCommitment.trim().toLowerCase().replace(/^0x/, "");
  if (!HEX32.test(policyId)) throw new LaceMidnightError(ErrorCodes.InvalidRequest, "policyId must be 32 bytes of hex");
  if (!HEX32.test(evidenceCommitment)) {
    throw new LaceMidnightError(ErrorCodes.InvalidRequest, "evidenceCommitment must be 32 bytes of hex");
  }
  const chk = await checkPolicyKey(a.key, a.datumCommitment);
  if (!chk.ok) {
    throw new LaceMidnightError(ErrorCodes.InvalidRequest, chk.reason ?? "Policy key check failed", {
      recoverable: true,
    });
  }
  return {
    circuit: BrowserCircuits.fileClaim,
    policyId,
    evidenceCommitment,
    contractAddress: (a.contractAddress ?? PREPROD_V2_CONTRACT_ADDRESS).toLowerCase().replace(/^0x/, ""),
    network: "preprod",
    privateState: holderPrivateState(a.key),
  };
}

export type PrepareProveCoverArgs = {
  key: PolicyKey;
  /** Defaults to the key's coverage (prove at least the sold limit). */
  minCoverage?: string | bigint;
  contractAddress?: string;
  datumCommitment?: string;
};

/** Build a validated proveCover call from a policy key. */
export async function prepareProveCoverCall(a: PrepareProveCoverArgs): Promise<ProveCoverCall> {
  const policyId = a.key.policyId.toLowerCase();
  if (!HEX32.test(policyId)) throw new LaceMidnightError(ErrorCodes.InvalidRequest, "policyId must be 32 bytes of hex");
  const chk = await checkPolicyKey(a.key, a.datumCommitment);
  if (!chk.ok) {
    throw new LaceMidnightError(ErrorCodes.InvalidRequest, chk.reason ?? "Policy key check failed", {
      recoverable: true,
    });
  }
  const minCoverage = String(a.minCoverage ?? a.key.coverage);
  if (!/^\d+$/.test(minCoverage)) {
    throw new LaceMidnightError(ErrorCodes.InvalidRequest, "minCoverage must be a Uint<64> decimal string");
  }
  if (BigInt(minCoverage) > BigInt(a.key.coverage)) {
    throw new LaceMidnightError(
      ErrorCodes.InvalidRequest,
      "minCoverage cannot exceed the policy key's coverage",
      { recoverable: true },
    );
  }
  return {
    circuit: BrowserCircuits.proveCover,
    policyId,
    minCoverage,
    contractAddress: (a.contractAddress ?? PREPROD_V2_CONTRACT_ADDRESS).toLowerCase().replace(/^0x/, ""),
    network: "preprod",
    privateState: holderPrivateState(a.key),
  };
}

export type ReadinessCheckId =
  | "wallet-connected"
  | "network-preprod"
  | "proving-strategy"
  | "prover-reachable"
  | "circuit-prover"
  | "call-prepared";

export type ReadinessCheck = {
  id: ReadinessCheckId;
  ok: boolean;
  required: boolean;
  detail: string;
};

export type CircuitSubmitReadiness = {
  ready: boolean;
  /** True when Lace path + call are ready but the midnight-js prover is still missing. */
  lacePathReady: boolean;
  checks: ReadinessCheck[];
  proving: ProvingStrategy;
  services: ServiceUriSummary;
};

export type AssessCircuitSubmitArgs = {
  connected: boolean;
  networkId?: string | null;
  configuration?: Configuration | null;
  services?: ServiceUriSummary | null;
  api?: Pick<ConnectedAPI, "getProvingProvider"> | null;
  /** Whether a BrowserCircuitProver is available to build+prove the Compact call. */
  hasCircuitProver?: boolean;
  /** Whether prepareFileClaimCall / prepareProveCoverCall already succeeded. */
  callPrepared?: boolean;
  /** Optional live prover probe result (skip network in unit tests). */
  proverHealth?: ProverHealth | null;
};

export function assessCircuitSubmitReadiness(a: AssessCircuitSubmitArgs): CircuitSubmitReadiness {
  const services =
    a.services ??
    summarizeConfiguration(a.configuration ?? null);
  const proving = resolveProvingStrategy(a.api, a.configuration ?? services);
  const checks: ReadinessCheck[] = [];

  checks.push({
    id: "wallet-connected",
    ok: a.connected === true,
    required: true,
    detail: a.connected ? "Midnight wallet connected" : "Connect Lace Midnight on Preprod first",
  });

  const onPreprod = (a.networkId ?? "").toLowerCase() === "preprod";
  checks.push({
    id: "network-preprod",
    ok: !a.connected || onPreprod,
    required: true,
    detail: !a.connected
      ? "Network checked after connect"
      : onPreprod
        ? "Connected network is Preprod"
        : `Wallet reports network "${a.networkId ?? "(none)"}"; switch Lace to Preprod`,
  });

  checks.push({
    id: "proving-strategy",
    ok: proving.kind !== "unavailable",
    required: true,
    detail: proving.detail,
  });

  if (proving.kind === "http") {
    const health = a.proverHealth;
    checks.push({
      id: "prover-reachable",
      ok: health ? health.ok : false,
      required: true,
      detail: health
        ? health.detail
        : `Proof server at ${proving.proverServerUri} not probed yet`,
    });
  } else if (proving.kind === "delegated") {
    checks.push({
      id: "prover-reachable",
      ok: true,
      required: true,
      detail: "Delegated proving — wallet hosts the prover",
    });
  } else {
    checks.push({
      id: "prover-reachable",
      ok: false,
      required: true,
      detail: proving.detail,
    });
  }

  checks.push({
    id: "circuit-prover",
    ok: a.hasCircuitProver === true,
    required: true,
    detail: a.hasCircuitProver
      ? "Browser Compact prover is loaded (midnight-js + ZK configs)"
      : "Browser Compact prover not loaded yet — use the holder claim kit CLI, or inject a BrowserCircuitProver",
  });

  checks.push({
    id: "call-prepared",
    ok: a.callPrepared === true,
    required: true,
    detail: a.callPrepared ? "Circuit call args prepared" : "Seal evidence (and restore the policy key) to prepare the call",
  });

  const lacePathReady = checks
    .filter((c) => c.id !== "circuit-prover")
    .every((c) => c.ok);
  const ready = checks.every((c) => c.ok);

  return { ready, lacePathReady, checks, proving, services };
}

/** Ask Lace to permission the methods a circuit submit will use. */
export async function hintCircuitPermissions(
  api: Pick<ConnectedAPI, "hintUsage">,
  methods: ReadonlyArray<keyof WalletConnectedAPI> = CIRCUIT_SUBMIT_HINT_METHODS,
): Promise<void> {
  try {
    await api.hintUsage([...methods]);
  } catch (err) {
    throw normalizeConnectorError(err);
  }
}

export type BalanceAndSubmitResult = {
  balancedTx: string;
  submitted: true;
};

/**
 * Balance a proven unsealed transaction through Lace and submit it.
 * ConnectedAPI works on serialized tx strings — no midnight-js types required here.
 */
export async function balanceAndSubmitViaLace(
  api: Pick<ConnectedAPI, "balanceUnsealedTransaction" | "submitTransaction" | "hintUsage">,
  unsealedTx: string,
  options: { payFees?: boolean; hint?: boolean } = {},
): Promise<BalanceAndSubmitResult> {
  if (!unsealedTx || typeof unsealedTx !== "string") {
    throw new LaceMidnightError(ErrorCodes.InvalidRequest, "unsealedTx must be a non-empty serialized transaction string");
  }
  try {
    if (options.hint !== false) {
      await hintCircuitPermissions(api);
    }
    const { tx } = await api.balanceUnsealedTransaction(unsealedTx, {
      payFees: options.payFees !== false,
    });
    await api.submitTransaction(tx);
    return { balancedTx: tx, submitted: true };
  } catch (err) {
    throw normalizeConnectorError(err);
  }
}

/**
 * Builds + proves a Compact circuit call, returning a proven unsealed tx string
 * suitable for balanceAndSubmitViaLace. Implementations wrap midnight-js
 * findDeployedContract(...).callTx.fileClaim / proveCover.
 */
export type BrowserCircuitProver = {
  proveFileClaim(call: FileClaimCall, ctx: { proving: ProvingStrategy }): Promise<{ unsealedTx: string }>;
  proveProveCover(call: ProveCoverCall, ctx: { proving: ProvingStrategy }): Promise<{ unsealedTx: string }>;
};

export type BrowserFileClaimResult = {
  call: FileClaimCall;
  proving: ProvingStrategy;
  submit: BalanceAndSubmitResult;
};

export type BrowserProveCoverResult = {
  call: ProveCoverCall;
  proving: ProvingStrategy;
  submit: BalanceAndSubmitResult;
};

/**
 * Full browser fileClaim: prepare → hint → prove (injected) → balance+submit via Lace.
 */
export async function runBrowserFileClaim(args: {
  api: ConnectedAPI;
  key: PolicyKey;
  evidenceCommitment: string;
  prover: BrowserCircuitProver;
  configuration?: Configuration | null;
  contractAddress?: string;
  datumCommitment?: string;
  payFees?: boolean;
}): Promise<BrowserFileClaimResult> {
  const call = await prepareFileClaimCall({
    key: args.key,
    evidenceCommitment: args.evidenceCommitment,
    contractAddress: args.contractAddress,
    datumCommitment: args.datumCommitment,
  });
  let configuration = args.configuration ?? null;
  if (!configuration) {
    try {
      configuration = await args.api.getConfiguration();
    } catch {
      configuration = null;
    }
  }
  const proving = resolveProvingStrategy(args.api, configuration);
  if (proving.kind === "unavailable") {
    throw new LaceMidnightError(KitErrorCodes.WalletUnavailable, proving.detail, { recoverable: true });
  }
  await hintCircuitPermissions(args.api);
  const { unsealedTx } = await args.prover.proveFileClaim(call, { proving });
  const submit = await balanceAndSubmitViaLace(args.api, unsealedTx, {
    payFees: args.payFees,
    hint: false,
  });
  return { call, proving, submit };
}

/**
 * Full browser proveCover: prepare → hint → prove (injected) → balance+submit via Lace.
 */
export async function runBrowserProveCover(args: {
  api: ConnectedAPI;
  key: PolicyKey;
  prover: BrowserCircuitProver;
  minCoverage?: string | bigint;
  configuration?: Configuration | null;
  contractAddress?: string;
  datumCommitment?: string;
  payFees?: boolean;
}): Promise<BrowserProveCoverResult> {
  const call = await prepareProveCoverCall({
    key: args.key,
    minCoverage: args.minCoverage,
    contractAddress: args.contractAddress,
    datumCommitment: args.datumCommitment,
  });
  let configuration = args.configuration ?? null;
  if (!configuration) {
    try {
      configuration = await args.api.getConfiguration();
    } catch {
      configuration = null;
    }
  }
  const proving = resolveProvingStrategy(args.api, configuration);
  if (proving.kind === "unavailable") {
    throw new LaceMidnightError(KitErrorCodes.WalletUnavailable, proving.detail, { recoverable: true });
  }
  await hintCircuitPermissions(args.api);
  const { unsealedTx } = await args.prover.proveProveCover(call, { proving });
  const submit = await balanceAndSubmitViaLace(args.api, unsealedTx, {
    payFees: args.payFees,
    hint: false,
  });
  return { call, proving, submit };
}
