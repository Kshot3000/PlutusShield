"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import {
  EVIDENCE_LIMITS,
  INCIDENT_KINDS,
  checkEvidence,
  evidenceFileText,
  hashAttachment,
  matchAttachments,
  sealEvidence,
  verifyEvidence,
  type AttachmentMatch,
  type EvidenceAttachment,
  type EvidenceBundle,
  type EvidenceChain,
  type EvidenceInput,
  type EvidenceIssue,
  type EvidenceVerification,
  type IncidentKind,
  type SealedEvidence,
} from "@plutusshield/sdk/evidence";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup, Chip } from "@/components/ui/ChoiceGroup";

/* ---------- small helpers ---------- */

const MAX_FILE_BYTES = 50 * 1024 * 1024;

const randomHex = (bytes: number) => {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
};

const lines = (s: string) => s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);

/** Date → value for <input type="datetime-local"> in the user's local time. */
const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const localTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const short = (h: string, n = 10) => (h.length > 2 * n + 1 ? `${h.slice(0, n)}…${h.slice(-n)}` : h);

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const fileBase = (commitment: string) => `plutusshield-evidence-${commitment.slice(0, 12)}`;

const inputCls =
  "w-full rounded-xl border bg-bg-muted px-3 text-[14px] text-text outline-none transition-colors placeholder:text-text-dim focus:border-accent focus:ring-2 focus:ring-accent/30 [color-scheme:dark]";

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: (a11y: { id: string; "aria-invalid"?: true; "aria-describedby"?: string; className: string }) => ReactNode;
}) {
  const msg = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-sm text-text-muted">
        {label}
      </label>
      <div className="mt-1.5">
        {children({
          id,
          "aria-invalid": error ? true : undefined,
          "aria-describedby": error || hint ? msg : undefined,
          className: `${inputCls} ${error ? "border-[color-mix(in_srgb,var(--danger)_60%,var(--border))]" : "border-border-strong"}`,
        })}
      </div>
      {(error || hint) && (
        <p id={msg} className={`mt-1.5 text-[11px] leading-relaxed ${error ? "text-[var(--danger)]" : "text-text-dim"}`}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1_600);
        } catch {
          /* clipboard blocked; the value is selectable */
        }
      }}
      className="shrink-0 rounded-full border border-border px-2.5 py-1 font-mono text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {done ? "Copied" : label}
    </button>
  );
}

function Hex({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--hairline)] bg-bg-muted/60 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono-label text-[9.5px] text-text-dim">{label}</p>
        {copy && <CopyButton value={value} label="Copy" />}
      </div>
      <p className="mt-1.5 break-all font-mono text-[12px] leading-relaxed text-text">{value}</p>
    </div>
  );
}

function CheckRow({ label, ok, children }: { label: string; ok: boolean | null; children?: ReactNode }) {
  return (
    <li className="flex gap-3 border-t border-[var(--hairline)] py-3 first:border-t-0">
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          ok === null
            ? "bg-white/[0.06] text-text-dim"
            : ok
              ? "bg-[color-mix(in_srgb,var(--success)_20%,transparent)] text-success"
              : "bg-[color-mix(in_srgb,var(--danger)_20%,transparent)] text-danger"
        }`}
        aria-hidden="true"
      >
        {ok === null ? "·" : ok ? "✓" : "×"}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text">
          {label}
          <span className="sr-only">: {ok === null ? "not checked" : ok ? "passes" : "fails"}</span>
        </p>
        {children ? <div className="mt-0.5 break-words text-[12.5px] leading-relaxed text-text-muted">{children}</div> : null}
      </div>
    </li>
  );
}

/* ---------- form ---------- */

interface Form {
  policyId: string;
  protocol: string;
  chain: EvidenceChain;
  contracts: string;
  kind: IncidentKind;
  description: string;
  txHashes: string;
  amount: string;
  asset: string;
  startedAt: string;
  detectedAt: string;
}

const EMPTY: Form = {
  policyId: "",
  protocol: "",
  chain: "cardano",
  contracts: "",
  kind: "logic-bug",
  description: "",
  txHashes: "",
  amount: "",
  asset: "ADA",
  startedAt: "",
  detectedAt: "",
};

function exampleForm(): Form {
  const now = Date.now();
  return {
    policyId: randomHex(32),
    protocol: "Example DEX (demo)",
    chain: "cardano",
    contracts: "addr_test1wexample0swap0validator0not0real",
    kind: "logic-bug",
    description:
      "Example only. The swap validator accepted an output datum with a forged pool NFT, so the attacker withdrew both sides of the ADA/USDC pool in two transactions. My LP position was in that pool.",
    txHashes: `${randomHex(32)}\n${randomHex(32)}`,
    amount: "1250.5",
    asset: "ADA",
    startedAt: localInput(new Date(now - 30 * 3_600_000)),
    detectedAt: localInput(new Date(now - 29 * 3_600_000)),
  };
}

const toInput = (f: Form, attachments: EvidenceAttachment[]): EvidenceInput => ({
  policyId: f.policyId,
  protocol: { name: f.protocol, chain: f.chain, contracts: lines(f.contracts) },
  incident: {
    kind: f.kind,
    description: f.description,
    startedAt: f.startedAt ? new Date(f.startedAt) : "",
    detectedAt: f.detectedAt ? new Date(f.detectedAt) : "",
  },
  txHashes: lines(f.txHashes),
  loss: { amount: f.amount, asset: f.asset },
  attachments,
});

function SealForm({ onSealed }: { onSealed: (s: SealedEvidence) => void }) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [attachments, setAttachments] = useState<EvidenceAttachment[]>([]);
  const [hashing, setHashing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [issues, setIssues] = useState<EvidenceIssue[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    const next = { ...form, [k]: v };
    setForm(next);
    if (issues) setIssues(checkEvidence(toInput(next, attachments)));
  };
  const err = (path: string) => issues?.find((i) => i.path === path || i.path.startsWith(`${path}.`))?.message;

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    setFileError(null);
    setHashing(true);
    try {
      const next = [...attachments];
      for (const f of Array.from(files)) {
        if (f.size > MAX_FILE_BYTES) {
          setFileError(`${f.name} is over 50 MB; hash it locally (sha256sum) and attach a smaller excerpt.`);
          continue;
        }
        const sha256 = await hashAttachment(new Uint8Array(await f.arrayBuffer()));
        if (next.some((a) => a.sha256 === sha256)) continue;
        next.push({ name: f.name, mediaType: f.type || "application/octet-stream", size: f.size, sha256 });
      }
      if (next.length > EVIDENCE_LIMITS.attachments) setFileError(`At most ${EVIDENCE_LIMITS.attachments} files.`);
      setAttachments(next.slice(0, EVIDENCE_LIMITS.attachments));
    } finally {
      setHashing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function seal() {
    setError(null);
    const input = toInput(form, attachments);
    const found = checkEvidence(input);
    setIssues(found);
    if (found.length) return;
    setBusy(true);
    try {
      onSealed(await sealEvidence(input));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="glass-panel relative space-y-7 p-5 sm:p-8"
      onSubmit={(e) => {
        e.preventDefault();
        void seal();
      }}
      noValidate
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono-label text-[10px] text-text-dim">Exploit claim · evidence bundle</p>
        <button
          type="button"
          onClick={() => {
            setForm(exampleForm());
            setIssues(null);
          }}
          className="rounded-full border border-[color-mix(in_srgb,var(--gold)_40%,transparent)] px-3 py-1 font-mono text-[11px] text-gold transition-colors hover:bg-[var(--gold-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Fill with example data
        </button>
      </div>

      <fieldset className="min-w-0 space-y-4">
        <legend className="font-mono-label text-[10px] text-text-dim">1 · Policy and protocol</legend>
        <Field id="ev-policy" label="Policy id" hint="The 32-byte id of your exploit-cover policy (64 hex). It keys the claim on Midnight." error={err("policyId")}>
          {(a) => (
            <input {...a} className={`${a.className} h-11 font-mono text-[13px]`} value={form.policyId} onChange={(e) => set("policyId", e.target.value)} autoComplete="off" spellCheck={false} placeholder="64 hex characters" />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field id="ev-protocol" label="Affected protocol" error={err("protocol.name")}>
            {(a) => <input {...a} className={`${a.className} h-11`} value={form.protocol} onChange={(e) => set("protocol", e.target.value)} maxLength={EVIDENCE_LIMITS.protocolName} placeholder="e.g. the DEX or lending market" />}
          </Field>
          <ChoiceGroup<EvidenceChain>
            name="ev-chain"
            legend="Chain"
            value={form.chain}
            onChange={(v) => set("chain", v)}
            compact
            className="grid-cols-2"
            options={[
              { value: "cardano", label: "Cardano" },
              { value: "midnight", label: "Midnight" },
            ]}
          />
        </div>
        <Field id="ev-contracts" label="Affected contracts" hint="Script hashes, script addresses, or validator names. One per line." error={err("protocol.contracts")}>
          {(a) => <textarea {...a} rows={2} className={`${a.className} py-2.5 font-mono text-[13px]`} value={form.contracts} onChange={(e) => set("contracts", e.target.value)} spellCheck={false} />}
        </Field>
      </fieldset>

      <fieldset className="min-w-0 space-y-4">
        <legend className="font-mono-label text-[10px] text-text-dim">2 · What happened</legend>
        <ChoiceGroup<IncidentKind>
          name="ev-kind"
          legend="Incident type"
          value={form.kind}
          onChange={(v) => set("kind", v)}
          compact
          className="grid-cols-1 sm:grid-cols-2"
          options={INCIDENT_KINDS.map((k) => ({ value: k.id, label: k.label }))}
        />
        <Field id="ev-desc" label="Exploit description" hint="How the exploit worked and how it affected your position." error={err("incident.description")}>
          {(a) => <textarea {...a} rows={5} className={`${a.className} py-2.5 leading-relaxed`} value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={EVIDENCE_LIMITS.descriptionMax} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="ev-start" label="Exploit started" error={err("incident.startedAt")}>
            {(a) => <input {...a} type="datetime-local" className={`${a.className} h-11`} value={form.startedAt} onChange={(e) => set("startedAt", e.target.value)} />}
          </Field>
          <Field id="ev-detected" label="Detected" error={err("incident.detectedAt")}>
            {(a) => <input {...a} type="datetime-local" className={`${a.className} h-11`} value={form.detectedAt} onChange={(e) => set("detectedAt", e.target.value)} />}
          </Field>
        </div>
        <p className="-mt-2 text-[11px] text-text-dim">Your local time. The bundle stores UTC.</p>
        <Field id="ev-tx" label="Exploit transactions" hint="32-byte transaction ids (64 hex), one per line." error={err("txHashes")}>
          {(a) => <textarea {...a} rows={3} className={`${a.className} py-2.5 font-mono text-[12.5px]`} value={form.txHashes} onChange={(e) => set("txHashes", e.target.value)} spellCheck={false} />}
        </Field>
      </fieldset>

      <fieldset className="min-w-0 space-y-4">
        <legend className="font-mono-label text-[10px] text-text-dim">3 · Loss and attachments</legend>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field id="ev-amount" label="Your loss" error={err("loss.amount")}>
            {(a) => <input {...a} inputMode="decimal" className={`${a.className} h-11 font-mono`} value={form.amount} onChange={(e) => set("amount", e.target.value.replace(/[^0-9.,]/g, ""))} autoComplete="off" placeholder="0.00" />}
          </Field>
          <Field id="ev-asset" label="Asset" error={err("loss.asset")}>
            {(a) => <input {...a} className={`${a.className} h-11 font-mono`} value={form.asset} onChange={(e) => set("asset", e.target.value.trim())} autoComplete="off" spellCheck={false} />}
          </Field>
        </div>
        <div className="-mt-2 flex flex-wrap gap-1.5">
          {["ADA", "USDC", "USDM"].map((t) => (
            <button key={t} type="button" onClick={() => set("asset", t)} className="rounded-full border border-border px-2.5 py-1 font-mono text-[11px] text-text-muted transition-colors hover:border-border-strong hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              {t}
            </button>
          ))}
        </div>

        <div>
          <label htmlFor="ev-files" className="block text-sm text-text-muted">
            Supporting files <span className="text-text-dim">(optional)</span>
          </label>
          <input id="ev-files" ref={fileRef} type="file" multiple onChange={(e) => void addFiles(e.target.files)} className="mt-1.5 block w-full text-[13px] text-text-muted file:mr-3 file:rounded-full file:border file:border-[var(--hairline)] file:bg-white/[0.04] file:px-3.5 file:py-1.5 file:text-[13px] file:text-text hover:file:bg-white/[0.07]" />
          <p className="mt-1.5 text-[11px] leading-relaxed text-text-dim">
            Only each file&apos;s name, size and SHA-256 go into the bundle. Keep the files: the assessor checks them against these hashes.
          </p>
          {hashing && <p className="mt-2 text-[12px] text-text-muted" aria-live="polite">Hashing…</p>}
          {fileError && <p className="mt-2 text-[12px] text-[var(--danger)]">{fileError}</p>}
          {err("attachments") && <p className="mt-2 text-[12px] text-[var(--danger)]">{err("attachments")}</p>}
          {attachments.length > 0 && (
            <ul className="mt-3 divide-y divide-[var(--hairline)] rounded-xl border border-[var(--hairline)]">
              {attachments.map((f) => (
                <li key={f.sha256} className="flex items-center gap-3 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-text">{f.name}</p>
                    <p className="truncate font-mono text-[11px] text-text-dim">
                      {f.size.toLocaleString()} B · sha256 {short(f.sha256, 8)}
                    </p>
                  </div>
                  <button type="button" onClick={() => setAttachments((cur) => cur.filter((x) => x.sha256 !== f.sha256))} className="rounded-full px-2 py-1 text-[12px] text-text-dim hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={`Remove ${f.name}`}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </fieldset>

      {issues && issues.length > 0 && (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] p-3 text-[12.5px] text-text-muted" role="alert">
          Fix {issues.length} field{issues.length === 1 ? "" : "s"} above to seal the bundle.
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] p-3 text-[12.5px] text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" disabled={busy || hashing}>
          {busy ? "Sealing…" : "Encrypt and commit"}
        </Button>
        <p className="text-[12px] leading-relaxed text-text-dim">Runs in this browser with WebCrypto. Nothing is uploaded.</p>
      </div>
    </form>
  );
}

/* ---------- sealed result ---------- */

const HOW = [
  { t: "Canonical bundle", b: "Your answers become one deterministic JSON document (sorted keys, normalized hex, UTC times)." },
  { t: "Commit", b: "commitment = SHA-256(\"plutusshield:evidence:v1\" ‖ SHA-256(bundle) ‖ salt), the contract's evidenceCommitment." },
  { t: "Encrypt", b: "AES-256-GCM under a fresh random key. You download the encrypted bundle and a separate key file." },
  { t: "File, then disclose", b: "Only the commitment goes to fileClaim on Midnight. You hand the two files to the assessor privately." },
];

function SealedPanel({ sealed, onReset }: { sealed: SealedEvidence | null; onReset: () => void }) {
  const [saved, setSaved] = useState({ bundle: false, key: false });
  if (!sealed) {
    return (
      <section className="glass-panel relative p-5 sm:p-7">
        <p className="font-mono-label text-[10px] text-text-dim">How the vault works</p>
        <ol className="mt-4 space-y-4">
          {HOW.map((s, i) => (
            <li key={s.t} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--hairline)] font-mono text-[11px] text-text-muted">{i + 1}</span>
              <div>
                <p className="text-sm font-semibold text-text">{s.t}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-text-muted">{s.b}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-6 rounded-xl border border-[color-mix(in_srgb,var(--midnight)_35%,transparent)] bg-[var(--midnight-soft)] p-3.5 text-[12.5px] leading-relaxed text-text-muted">
          Nothing leaves this browser. There is no server and no upload; reload the page and it&apos;s gone.
        </div>
      </section>
    );
  }
  const base = fileBase(sealed.commitment);
  const b = sealed.bundle;
  return (
    <section className="glass-panel relative space-y-4 p-5 sm:p-7" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono-label text-[10px] text-text-dim">Sealed on this device</p>
        <Chip tone="accent">AES-256-GCM</Chip>
      </div>
      <div className="rounded-2xl border border-[color-mix(in_srgb,var(--success)_45%,transparent)] bg-[color-mix(in_srgb,var(--success)_8%,transparent)] p-4">
        <p className="font-display text-2xl leading-tight text-success">Evidence sealed</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">
          {b.txHashes.length} transaction{b.txHashes.length === 1 ? "" : "s"}, {b.attachments.length} file hash{b.attachments.length === 1 ? "" : "es"}, loss {b.loss.amount} {b.loss.asset}.
        </p>
      </div>
      <Hex label="Evidence commitment · goes on-ledger" value={sealed.commitment} copy />
      <Hex label="Bundle digest · SHA-256, stays private" value={sealed.digest} />

      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            download(`${base}.json`, evidenceFileText(sealed.envelope));
            setSaved((s) => ({ ...s, bundle: true }));
          }}
        >
          {saved.bundle ? "✓ " : "↓ "}Encrypted bundle
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            download(`${base}.key.json`, evidenceFileText(sealed.keyFile));
            setSaved((s) => ({ ...s, key: true }));
          }}
        >
          {saved.key ? "✓ " : "↓ "}Key file
        </Button>
      </div>
      <p className="text-[12px] leading-relaxed text-text-dim">
        The key file decrypts the bundle and holds the commitment salt. There is no other copy: lose it and the evidence
        can&apos;t be opened. Give it only to the assessor, over a private channel, and never post it publicly.
      </p>

      <div className="rounded-xl border border-[var(--hairline)] bg-bg-muted/60 p-3.5">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono-label text-[9.5px] text-text-dim">Midnight call · policy-cover.compact</p>
          <Chip tone="gold">Not live</Chip>
        </div>
        <pre className="mt-2 overflow-x-auto font-mono text-[11.5px] leading-relaxed text-text-muted">{`fileClaim(
  policyId:           ${short(b.policyId, 8)},
  evidenceCommitment: ${short(sealed.commitment, 8)}
)`}</pre>
        <p className="mt-2 text-[12px] leading-relaxed text-text-dim">
          The registry isn&apos;t deployed to any Midnight network yet, so this page can&apos;t file the claim. When it is,
          your wallet submits exactly this call. The bundle never enters the circuit; only the commitment is recorded.
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={onReset}>
        Start a new bundle
      </Button>
    </section>
  );
}

/* ---------- assessor ---------- */

function BundleSummary({ bundle, matches }: { bundle: EvidenceBundle; matches: { files: AttachmentMatch[]; missing: EvidenceAttachment[] } | null }) {
  const kind = INCIDENT_KINDS.find((k) => k.id === bundle.incident.kind)?.label ?? bundle.incident.kind;
  const rows: [string, ReactNode][] = [
    ["Policy", <span key="p" className="break-all font-mono text-[12px]">{bundle.policyId}</span>],
    ["Protocol", `${bundle.protocol.name} · ${bundle.protocol.chain === "cardano" ? "Cardano" : "Midnight"}`],
    ["Contracts", <span key="c" className="break-all font-mono text-[12px]">{bundle.protocol.contracts.join(" · ")}</span>],
    ["Incident", kind],
    ["Window", `${localTime(bundle.incident.startedAt)} → detected ${localTime(bundle.incident.detectedAt)}`],
    ["Claimed loss", <span key="l" className="font-mono">{bundle.loss.amount} {bundle.loss.asset}</span>],
    ["Sealed", localTime(bundle.createdAt)],
  ];
  return (
    <div className="space-y-4">
      <dl className="divide-y divide-[var(--hairline)] overflow-hidden rounded-xl border border-[var(--hairline)]">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[8rem_1fr] sm:gap-3">
            <dt className="font-mono-label text-[9.5px] leading-6 text-text-dim">{k}</dt>
            <dd className="min-w-0 text-[13px] leading-6 text-text">{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="font-mono-label text-[9.5px] text-text-dim">Description</p>
        <p className="mt-1.5 whitespace-pre-wrap break-words rounded-xl border border-[var(--hairline)] bg-bg-muted/60 p-3.5 text-[13px] leading-relaxed text-text-muted">{bundle.incident.description}</p>
      </div>
      <div>
        <p className="font-mono-label text-[9.5px] text-text-dim">Exploit transactions</p>
        <ul className="mt-1.5 space-y-1">
          {bundle.txHashes.map((h) => (
            <li key={h} className="break-all font-mono text-[11.5px] text-text-muted">{h}</li>
          ))}
        </ul>
      </div>
      {bundle.attachments.length > 0 && (
        <div>
          <p className="font-mono-label text-[9.5px] text-text-dim">Committed files</p>
          <ul className="mt-1.5 divide-y divide-[var(--hairline)] rounded-xl border border-[var(--hairline)]">
            {bundle.attachments.map((a) => {
              const got = matches?.files.find((f) => f.matches?.sha256 === a.sha256);
              return (
                <li key={a.sha256} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-text">{a.name}</p>
                    <p className="truncate font-mono text-[11px] text-text-dim">{a.size.toLocaleString()} B · {short(a.sha256, 8)}</p>
                  </div>
                  {matches ? <Chip tone={got ? "accent" : "default"}>{got ? `Matches ${got.name}` : "Not provided"}</Chip> : null}
                </li>
              );
            })}
          </ul>
          {matches && matches.files.some((f) => !f.matches) && (
            <p className="mt-2 text-[12px] text-[var(--danger)]">
              Not in the bundle: {matches.files.filter((f) => !f.matches).map((f) => f.name).join(", ")}. These files don&apos;t match any committed hash.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AssessorPanel({ sealed }: { sealed: SealedEvidence | null }) {
  const [bundleText, setBundleText] = useState<{ name: string; text: string } | null>(null);
  const [keyText, setKeyText] = useState<{ name: string; text: string } | null>(null);
  const [expected, setExpected] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<EvidenceVerification | null>(null);
  const [matches, setMatches] = useState<{ files: AttachmentMatch[]; missing: EvidenceAttachment[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const readJson = async (list: FileList | null, setter: (v: { name: string; text: string } | null) => void) => {
    const f = list?.[0];
    setResult(null);
    if (!f) return setter(null);
    setter({ name: f.name, text: f.size > MAX_FILE_BYTES ? "" : await f.text() });
  };

  async function verify() {
    setBusy(true);
    setMatches(null);
    try {
      const r = await verifyEvidence(bundleText?.text ?? "", keyText?.text ?? "", expected);
      setResult(r);
      if (r.bundle && files.length) {
        const loaded = await Promise.all(files.filter((f) => f.size <= MAX_FILE_BYTES).map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
        setMatches(await matchAttachments(r.bundle, loaded));
      }
    } finally {
      setBusy(false);
    }
  }

  const fileCls =
    "mt-1.5 block w-full text-[13px] text-text-muted file:mr-3 file:rounded-full file:border file:border-[var(--hairline)] file:bg-white/[0.04] file:px-3.5 file:py-1.5 file:text-[13px] file:text-text hover:file:bg-white/[0.07]";

  return (
    <section className="glass-panel relative mt-6 p-5 sm:p-8" aria-labelledby="assessor-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono-label text-[10px] text-midnight">Assessor</p>
          <h2 id="assessor-title" className="mt-2 font-display text-[1.9rem] leading-tight text-text">Open and verify a bundle</h2>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-text-muted">
            Load the encrypted bundle and key file the claimant sent you, paste the evidence commitment from the
            policy&apos;s Midnight record, and check that this is exactly the evidence that was filed. Decryption runs here.
          </p>
        </div>
        {sealed && (
          <Button
            variant="secondary"
            size="sm"
            className="self-start sm:self-auto"
            onClick={() => {
              const base = fileBase(sealed.commitment);
              setBundleText({ name: `${base}.json`, text: evidenceFileText(sealed.envelope) });
              setKeyText({ name: `${base}.key.json`, text: evidenceFileText(sealed.keyFile) });
              setExpected(sealed.commitment);
              setResult(null);
            }}
          >
            Use the bundle sealed above
          </Button>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <div>
            <label htmlFor="as-bundle" className="block text-sm text-text-muted">Encrypted bundle (.json)</label>
            <input id="as-bundle" type="file" accept="application/json,.json" onChange={(e) => void readJson(e.target.files, setBundleText)} className={fileCls} />
            {bundleText && <p className="mt-1 truncate font-mono text-[11px] text-text-dim">Loaded {bundleText.name}</p>}
          </div>
          <div>
            <label htmlFor="as-key" className="block text-sm text-text-muted">Key file (.key.json)</label>
            <input id="as-key" type="file" accept="application/json,.json" onChange={(e) => void readJson(e.target.files, setKeyText)} className={fileCls} />
            {keyText && <p className="mt-1 truncate font-mono text-[11px] text-text-dim">Loaded {keyText.name}</p>}
          </div>
          <Field id="as-commit" label="On-ledger evidence commitment" hint="From the policy's PolicyRecord.evidence on Midnight (64 hex).">
            {(a) => (
              <input
                {...a}
                className={`${a.className} border-border-strong h-11 font-mono text-[12.5px]`}
                value={expected}
                onChange={(e) => {
                  setExpected(e.target.value.trim());
                  setResult(null);
                }}
                autoComplete="off"
                spellCheck={false}
                placeholder="64 hex characters"
              />
            )}
          </Field>
          <div>
            <label htmlFor="as-files" className="block text-sm text-text-muted">
              Claimant&apos;s supporting files <span className="text-text-dim">(optional)</span>
            </label>
            <input id="as-files" type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className={fileCls} />
            <p className="mt-1.5 text-[11px] text-text-dim">Matched against the committed SHA-256 hashes.</p>
          </div>
          <Button type="submit" disabled={busy || !bundleText || !keyText}>
            {busy ? "Verifying…" : "Verify evidence"}
          </Button>
        </form>

        <div aria-live="polite">
          {!result ? (
            <div className="flex h-full min-h-[12rem] items-center justify-center rounded-2xl border border-dashed border-[var(--hairline)] p-6 text-center text-[13px] text-text-dim">
              Results appear here. Each step is checked separately so you can see exactly what fails.
            </div>
          ) : (
            <div className="space-y-5">
              <div
                className={`rounded-2xl border p-4 ${
                  result.ok
                    ? "border-[color-mix(in_srgb,var(--success)_45%,transparent)] bg-[color-mix(in_srgb,var(--success)_8%,transparent)]"
                    : result.bundle
                      ? "border-[color-mix(in_srgb,var(--gold)_45%,transparent)] bg-[color-mix(in_srgb,var(--gold)_7%,transparent)]"
                      : "border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger)_7%,transparent)]"
                }`}
              >
                <p className={`font-display text-2xl leading-tight ${result.ok ? "text-success" : result.bundle ? "text-gold" : "text-danger"}`}>
                  {result.ok ? "Verified: this is the filed evidence" : result.bundle ? "Opens, but not matched to the ledger" : "Verification failed"}
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">
                  {result.ok
                    ? "The bundle decrypts, is canonical, and opens the commitment recorded on-ledger. Whether the claim is valid is still your call."
                    : result.bundle
                      ? "The files are internally consistent, but the commitment doesn't match the one you entered (or none was entered)."
                      : "Don't rely on this bundle. See the failing step below."}
                </p>
              </div>
              <ul>
                {result.checks.map((c) => (
                  <CheckRow key={c.id} label={c.label} ok={c.ok}>
                    {c.detail || null}
                  </CheckRow>
                ))}
              </ul>
              {result.bundle && <BundleSummary bundle={result.bundle} matches={matches} />}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------- page body ---------- */

export function EvidenceVault() {
  const [sealed, setSealed] = useState<SealedEvidence | null>(null);
  const [formKey, setFormKey] = useState(0);
  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <SealForm key={formKey} onSealed={setSealed} />
        <div className="lg:sticky lg:top-24 lg:self-start">
          <SealedPanel
            key={sealed?.commitment ?? "none"}
            sealed={sealed}
            onReset={() => {
              setSealed(null);
              setFormKey((k) => k + 1);
            }}
          />
        </div>
      </div>
      <AssessorPanel sealed={sealed} />
    </>
  );
}
