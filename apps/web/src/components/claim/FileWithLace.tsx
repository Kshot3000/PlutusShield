"use client";

/**
 * Browser fileClaim / proveCover path wired to the connected Lace Midnight
 * wallet: readiness checklist, proving strategy (delegated vs HTTP), prover
 * health probe, permission hints, and submit via ConnectedAPI when a
 * BrowserCircuitProver is available. Until midnight-js is injected, Lace
 * plumbing + ZK asset probes still run and the holder claim kit remains the production filer.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PREPROD_V2_CONTRACT_ADDRESS,
  assessCircuitSubmitReadiness,
  hintCircuitPermissions,
  prepareFileClaimCall,
  prepareProveCoverCall,
  probeProverHealth,
  resolveProvingStrategy,
  runBrowserFileClaim,
  runBrowserProveCover,
  type CircuitSubmitReadiness,
  type FileClaimCall,
  type ProveCoverCall,
  type ProvingStrategy,
} from "@plutusshield/sdk/laceCircuits";
import { isLaceMidnightError, userHintForError } from "@plutusshield/sdk/lace";
import type { PolicyKey } from "@plutusshield/sdk/midnight";
import type { SealedEvidence } from "@plutusshield/sdk/evidence";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/ChoiceGroup";
import { useMidnightWallet } from "@/lib/midnightWallet";
import { getBrowserCircuitProver, probeDefaultZkAssets } from "@/lib/browserCircuit";
import { zkAssetsReadinessSummary } from "@plutusshield/sdk/fetchZkConfig";

const short = (h: string, n = 8) => (h.length > 2 * n + 1 ? `${h.slice(0, n)}…${h.slice(-n)}` : h);

function describeError(e: unknown): string {
  if (isLaceMidnightError(e)) return userHintForError(e);
  return e instanceof Error ? e.message : String(e);
}

export function FileWithLace({
  sealed,
  policyKey,
}: {
  sealed: Pick<SealedEvidence, "commitment" | "bundle">;
  policyKey: PolicyKey;
}) {
  const wallet = useMidnightWallet();
  const [readiness, setReadiness] = useState<CircuitSubmitReadiness | null>(null);
  const [fileCall, setFileCall] = useState<FileClaimCall | null>(null);
  const [proveCall, setProveCall] = useState<ProveCoverCall | null>(null);
  const [proving, setProving] = useState<ProvingStrategy | null>(null);
  const [busy, setBusy] = useState<"probe" | "hint" | "file" | "prove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<"fileClaim" | "proveCover" | null>(null);

  const connected = wallet.status === "connected";
  const policyId = sealed.bundle.policyId;

  const refresh = useCallback(async () => {
    setError(null);
    const prover = getBrowserCircuitProver();
    const api = wallet.sessionApi();
    let callOk = false;
    let preparedFile: FileClaimCall | null = null;
    let preparedProve: ProveCoverCall | null = null;
    try {
      preparedFile = await prepareFileClaimCall({
        key: policyKey,
        evidenceCommitment: sealed.commitment,
        contractAddress: PREPROD_V2_CONTRACT_ADDRESS,
      });
      preparedProve = await prepareProveCoverCall({
        key: policyKey,
        contractAddress: PREPROD_V2_CONTRACT_ADDRESS,
      });
      callOk = true;
      setFileCall(preparedFile);
      setProveCall(preparedProve);
    } catch (e) {
      setFileCall(null);
      setProveCall(null);
      setError(describeError(e));
    }

    const strategy = resolveProvingStrategy(api, wallet.services ?? null);
    setProving(strategy);

    let proverHealth = null;
    let zkAssets: { ok: boolean; detail: string } | null = null;
    setBusy("probe");
    try {
      if (strategy.kind === "http" && connected) {
        proverHealth = await probeProverHealth(strategy.proverServerUri);
      }
      const zkProbe = await probeDefaultZkAssets();
      zkAssets = zkAssetsReadinessSummary(zkProbe);
    } finally {
      setBusy(null);
    }

    setReadiness(
      assessCircuitSubmitReadiness({
        connected,
        networkId: wallet.networkId,
        services: wallet.services,
        api,
        hasCircuitProver: !!prover,
        callPrepared: callOk,
        proverHealth,
        zkAssets,
      }),
    );
  }, [connected, policyKey, sealed.commitment, wallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const laceReady = readiness?.lacePathReady === true;
  const canSubmit = readiness?.ready === true && !!wallet.sessionApi();

  const onHint = async () => {
    const api = wallet.sessionApi();
    if (!api) {
      setError("Connect Lace Midnight first.");
      return;
    }
    setBusy("hint");
    setError(null);
    setNote(null);
    try {
      await hintCircuitPermissions(api);
      setNote("Lace was asked to permission balance + submit for circuit calls.");
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  const onFileClaim = async () => {
    const api = wallet.sessionApi();
    const prover = getBrowserCircuitProver();
    if (!api || !prover || !fileCall) {
      setError("Browser Compact prover is not loaded. Download the claim kit and file with the CLI.");
      return;
    }
    setBusy("file");
    setError(null);
    setNote(null);
    try {
      const result = await runBrowserFileClaim({
        api,
        key: policyKey,
        evidenceCommitment: sealed.commitment,
        prover,
        contractAddress: PREPROD_V2_CONTRACT_ADDRESS,
      });
      setSubmitted("fileClaim");
      setNote(
        `fileClaim prepared and submitted via Lace (${result.proving.kind} proving). Balanced tx length ${result.submit.balancedTx.length}.`,
      );
      await refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  const onProveCover = async () => {
    const api = wallet.sessionApi();
    const prover = getBrowserCircuitProver();
    if (!api || !prover || !proveCall) {
      setError("Browser Compact prover is not loaded. proveCover still runs from the Preprod relay / holder tooling.");
      return;
    }
    setBusy("prove");
    setError(null);
    setNote(null);
    try {
      const result = await runBrowserProveCover({
        api,
        key: policyKey,
        prover,
        contractAddress: PREPROD_V2_CONTRACT_ADDRESS,
      });
      setSubmitted("proveCover");
      setNote(
        `proveCover prepared and submitted via Lace (${result.proving.kind} proving). Balanced tx length ${result.submit.balancedTx.length}.`,
      );
      await refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  const strategyLabel = useMemo(() => {
    if (!proving) return "…";
    if (proving.kind === "delegated") return "Delegated (wallet prover)";
    if (proving.kind === "http") {
      return proving.source === "lace-config" ? `HTTP · Lace ${short(proving.proverServerUri, 18)}` : `HTTP · default ${proving.proverServerUri}`;
    }
    return "Unavailable";
  }, [proving]);

  return (
    <div className="space-y-3 rounded-xl border border-[color-mix(in_srgb,var(--midnight)_35%,var(--hairline))] bg-[color-mix(in_srgb,var(--midnight)_6%,transparent)] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono-label text-[9.5px] text-text-dim">File with Lace · Midnight Preprod</p>
        <Chip tone={submitted ? "accent" : laceReady ? "gold" : "default"}>
          {submitted ? `Submitted ${submitted}` : laceReady ? "Lace path ready" : connected ? "Checking…" : "Connect Lace"}
        </Chip>
      </div>

      <p className="text-[12.5px] leading-relaxed text-text-muted">
        Uses the connected Lace Midnight wallet for permission hints, proving strategy (delegated{" "}
        <span className="font-mono">getProvingProvider</span> or Lace&apos;s HTTP{" "}
        <span className="font-mono">proverServerUri</span>), and{" "}
        <span className="font-mono">balanceUnsealedTransaction</span> + <span className="font-mono">submitTransaction</span>.
        ZK verifier/zkir for fileClaim and proveCover are probed from /zk/policy-cover-v2. Compact prove still needs an injected midnight-js
        <span className="font-mono">BrowserCircuitProver</span> (not in the Pages bundle yet) — until then the claim kit below files the same{" "}
        <span className="font-mono">fileClaim</span> from your machine.
      </p>

      <pre className="overflow-x-auto rounded-lg border border-[var(--hairline)] bg-bg/60 p-2.5 font-mono text-[11px] leading-relaxed text-text-muted">{`fileClaim(
  policyId:           ${short(policyId, 8)},
  evidenceCommitment: ${short(sealed.commitment, 8)}
)
proveCover(
  policyId:     ${short(policyId, 8)},
  minCoverage:  ${proveCall?.minCoverage ?? policyKey.coverage}
)
contract: ${short(PREPROD_V2_CONTRACT_ADDRESS, 10)}
proving:  ${strategyLabel}`}</pre>

      {readiness && (
        <ul className="space-y-1.5">
          {readiness.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-[12px] leading-snug">
              <span className={c.ok ? "text-[var(--accent)]" : "text-text-dim"} aria-hidden="true">
                {c.ok ? "✓" : "○"}
              </span>
              <span className={c.ok ? "text-text-muted" : "text-text-dim"}>
                <span className="font-mono text-[11px] text-text-dim">{c.id}</span>
                {" — "}
                {c.detail}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled={!connected || busy !== null} onClick={() => void refresh()}>
          {busy === "probe" ? "Probing prover + ZK…" : "Re-check Lace path"}
        </Button>
        <Button variant="secondary" size="sm" disabled={!connected || busy !== null} onClick={() => void onHint()}>
          {busy === "hint" ? "Hinting…" : "Hint Lace permissions"}
        </Button>
        <Button variant="secondary" size="sm" disabled={!canSubmit || busy !== null} onClick={() => void onProveCover()}>
          {busy === "prove" ? "Proving…" : "proveCover via Lace"}
        </Button>
        <Button variant="primary" size="sm" disabled={!canSubmit || busy !== null} onClick={() => void onFileClaim()}>
          {busy === "file" ? "Filing…" : "fileClaim via Lace"}
        </Button>
      </div>

      {!getBrowserCircuitProver() && (
        <p className="text-[12px] leading-relaxed text-text-dim">
          Compact prover not loaded in this page — Lace balance/submit is wired; download the claim kit to file today.
          Dev injection: <span className="font-mono">window.__PLUTUSSHIELD_CIRCUIT_PROVER__</span>.
        </p>
      )}
      {error && <p className="text-[12px] text-[var(--danger)]">{error}</p>}
      {note && <p className="text-[12px] text-[var(--accent)]">{note}</p>}
    </div>
  );
}
