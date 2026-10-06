"use client";

/**
 * Midnight policy keys in the UI: the backup panel shown right after a Buy,
 * and the per-policy "Midnight key" cell in My policies (status, export,
 * restore from a backup file). Keys live in lib/policyKeys.ts.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { isEncryptedPolicyKey, type PolicyKey } from "@plutusshield/sdk/midnight";
import { exportPolicyKey, importPolicyKey, keyState, usePolicyKeys, type KeyState } from "@/lib/policyKeys";
import { MirroredOnMidnight } from "@/components/midnight/LiveContractActivity";

const inputCls =
  "h-9 w-full rounded-lg border border-border bg-bg-muted px-3 text-[13px] text-text outline-none transition-colors placeholder:text-text-dim focus:border-accent focus:ring-2 focus:ring-accent/30 [color-scheme:dark]";

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

/** Passphrase form for an encrypted export. */
function EncryptForm({ onDone, onCancel, keyToExport, compact = false }: { keyToExport: PolicyKey; onDone: () => void; onCancel: () => void; compact?: boolean }) {
  const id = useId();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tooShort = p1.length > 0 && p1.length < 8;
  const differs = p2.length > 0 && p1 !== p2;
  async function go() {
    if (p1.length < 8 || p1 !== p2) return;
    setBusy(true);
    setErr(null);
    try {
      await exportPolicyKey(keyToExport, p1);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className={`space-y-2 ${compact ? "" : "rounded-xl border border-border bg-white/[0.02] p-3"}`}
      onSubmit={(e) => {
        e.preventDefault();
        void go();
      }}
    >
      <label htmlFor={`${id}-p1`} className="block text-[11px] text-text-muted">
        Passphrase (8+ characters). It isn&apos;t stored anywhere; forget it and the backup can&apos;t be opened.
      </label>
      <input id={`${id}-p1`} type="password" autoComplete="new-password" className={inputCls} value={p1} onChange={(e) => setP1(e.target.value)} placeholder="Passphrase" />
      <input aria-label="Repeat passphrase" type="password" autoComplete="new-password" className={inputCls} value={p2} onChange={(e) => setP2(e.target.value)} placeholder="Repeat passphrase" />
      {(tooShort || differs || err) && <p className="text-[11px] text-[var(--danger)]">{err ?? (tooShort ? "At least 8 characters." : "Passphrases don't match.")}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="submit" disabled={busy || p1.length < 8 || p1 !== p2}>
          {busy ? "Encrypting…" : "↓ Encrypted backup"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Shown under a successful Buy: what the key is, and the two ways to back it up. */
export function PolicyKeyBackup({ policyKey, stored }: { policyKey: PolicyKey; stored: boolean }) {
  const [saved, setSaved] = useState<{ plain?: boolean; encrypted?: boolean }>({});
  const [encrypting, setEncrypting] = useState(false);
  return (
    <div className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--midnight)_35%,var(--border))] bg-[var(--midnight-soft)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="midnight">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--midnight)]" aria-hidden />
          Midnight policy key
        </Badge>
        <span className="text-[11px] text-text-dim">{stored ? "Saved in this browser" : "Not saved in this browser: download it now"}</span>
      </div>
      <p className="mt-2.5 text-[13px] leading-relaxed text-text">
        Your browser made a private key for this policy before you signed. Only its commitment went on Cardano. On Midnight, this key
        is how you prove you hold the cover, and how you file a claim, without showing your wallet or your coverage.
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-text-muted">
        Back it up now. Clearing site data or switching browsers deletes the saved copy, and there is no other copy. Anyone with the
        plain file can prove or claim as you on Midnight, so keep it private. The encrypted backup is safer to keep in cloud storage.
      </p>
      <dl className="mt-2.5 grid gap-1 font-mono text-[11px] text-text-dim">
        <div className="flex gap-2">
          <dt>policy id</dt>
          <dd className="text-text-muted">{short(policyKey.policyId)}</dd>
        </div>
        <div className="flex gap-2">
          <dt>datum commitment</dt>
          <dd className="text-text-muted">{short(policyKey.registrationCommitment)}</dd>
        </div>
      </dl>
      {encrypting ? (
        <div className="mt-3">
          <EncryptForm keyToExport={policyKey} onDone={() => (setSaved((s) => ({ ...s, encrypted: true })), setEncrypting(false))} onCancel={() => setEncrypting(false)} />
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEncrypting(true)}>
            {saved.encrypted ? "✓ " : ""}Encrypted backup…
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void exportPolicyKey(policyKey);
              setSaved((s) => ({ ...s, plain: true }));
            }}
          >
            {saved.plain ? "✓ " : "↓ "}Plain key file
          </Button>
        </div>
      )}
    </div>
  );
}

const stateCopy: Record<KeyState, { label: string; variant: "midnight" | "gold" | "default" }> = {
  verified: { label: "On this device", variant: "midnight" },
  mismatch: { label: "Key mismatch", variant: "gold" },
  missing: { label: "Not on this device", variant: "default" },
};

/** The "Midnight key" cell of a My policies row. */
export function MidnightKeyCell({ policyId, midnightCommitment, holder }: { policyId: string; midnightCommitment: string; holder: boolean }) {
  const keys = usePolicyKeys();
  const key = keys[policyId.toLowerCase()];
  const [state, setState] = useState<KeyState | null>(null);
  const [mode, setMode] = useState<"idle" | "encrypt" | "passphrase">("idle");
  const [pending, setPending] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void keyState(key, midnightCommitment).then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, [key, midnightCommitment]);

  async function restore(text: string, passphrase?: string) {
    try {
      await importPolicyKey(text, { policyId, midnightCommitment }, passphrase);
      setMsg({ ok: true, text: "Restored. The key opens this policy's commitment." });
      setMode("idle");
      setPending(null);
      setPass("");
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    setMsg(null);
    const text = await f.text();
    if (isEncryptedPolicyKey(text)) {
      setPending(text);
      setMode("passphrase");
    } else void restore(text);
    if (file.current) file.current.value = "";
  }

  if (state === null) return <span className="text-[11px] text-text-dim">Checking…</span>;
  const s = stateCopy[state];
  const linkBtn = "text-[11px] text-text-muted underline underline-offset-4 transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded";

  return (
    <div className="max-w-[230px] space-y-1.5">
      <Badge variant={s.variant}>{s.label}</Badge>
      <MirroredOnMidnight policyId={policyId} />
      {state === "missing" && !holder && <span className="block text-[11px] leading-snug text-text-dim">The key stays with whoever bought it.</span>}
      {state === "mismatch" && <span className="block text-[11px] leading-snug text-[var(--gold)]">The saved key doesn&apos;t open this policy&apos;s on-chain commitment.</span>}

      {mode === "encrypt" && key ? (
        <EncryptForm compact keyToExport={key} onDone={() => (setMode("idle"), setMsg({ ok: true, text: "Encrypted backup downloaded." }))} onCancel={() => setMode("idle")} />
      ) : mode === "passphrase" && pending ? (
        <form
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void restore(pending, pass);
          }}
        >
          <input aria-label="Backup passphrase" type="password" autoComplete="current-password" className={inputCls} value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Backup passphrase" />
          <div className="flex gap-3">
            <button type="submit" className={linkBtn}>Unlock &amp; restore</button>
            <button type="button" className={linkBtn} onClick={() => (setMode("idle"), setPending(null), setPass(""))}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {key && state === "verified" ? (
            <>
              <button type="button" className={linkBtn} onClick={() => setMode("encrypt")} aria-label="Export an encrypted backup of this policy's Midnight key">
                Export encrypted
              </button>
              <button type="button" className={linkBtn} onClick={() => void exportPolicyKey(key)} aria-label="Export this policy's Midnight key as a plain JSON file">
                Plain
              </button>
            </>
          ) : (
            <button type="button" className={linkBtn} onClick={() => file.current?.click()}>
              Restore from backup
            </button>
          )}
          <input ref={file} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[11px] ${msg.ok ? "text-[var(--accent)]" : "text-[var(--danger)]"}`}>{msg.text}</p>}
    </div>
  );
}
