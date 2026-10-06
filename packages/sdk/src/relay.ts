/**
 * Cardano Preview -> Midnight relay: which PlutusShield policies can be
 * mirrored into policy-cover.compact, and the public "registration ticket"
 * every Buy carries so the issuer relay can register it from chain data alone.
 *
 * registerPolicy(id, holder, coverage, expiry, cardanoCommitment) needs the
 * holder and coverage commitments, but the Cardano datum only stores their
 * hash (midnight_commitment = registrationCommitment(id, holder, coverage)).
 * So the Buy transaction also publishes the two commitments as tx metadata
 * under MIDNIGHT_TICKET_LABEL. They are hiding (a hash of the holder secret,
 * a salted commitment to the amount) and become public on Midnight anyway the
 * moment the policy is registered, so the ticket reveals nothing new. The
 * relay never trusts a ticket on its own: it must open the datum's
 * midnight_commitment, and the circuit re-checks the same binding.
 *
 * proveCover still needs the holder secret, which only the buyer's device (or
 * their policy key file) has.
 *
 * Pure: WebCrypto only, no network. Used by the relay CLI, the Midnight
 * snapshot at build time and the /cover page.
 */
import { registrationCommitment, type PolicyKey } from "./midnight.ts";

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Cardano tx metadata label for the PlutusShield Midnight registration ticket. */
export const MIDNIGHT_TICKET_LABEL = 7731;
export const MIDNIGHT_TICKET_VERSION = 1;

/**
 * Buys whose policy datum predates the Midnight binding (Preview, before the
 * first bound Buy 7c3365bb… at 2026-10-06 17:23 UTC) carry a random
 * placeholder midnight_commitment that no holder key opens: registerPolicy
 * rejects them by construction, so they can never be mirrored.
 */
export const MIDNIGHT_BINDING_SINCE_MS = Date.parse("2026-10-06T17:20:00Z");

const HEX32 = /^[0-9a-f]{64}$/;

export interface RegistrationTicket {
  policyId: string;
  holderCommitment: string;
  coverageCommitment: string;
}

/** Metadata value for a Buy (each string is 64 hex chars, within the 64-byte metadata string limit). */
export function ticketMetadata(key: Pick<PolicyKey, "policyId" | "holderCommitment" | "coverageCommitment">) {
  const t = { policyId: key.policyId.toLowerCase(), holderCommitment: key.holderCommitment.toLowerCase(), coverageCommitment: key.coverageCommitment.toLowerCase() };
  for (const [k, v] of Object.entries(t)) if (!HEX32.test(v)) throw new Error(`ticket ${k} must be 32 bytes of hex`);
  return { v: MIDNIGHT_TICKET_VERSION, p: t.policyId, h: t.holderCommitment, c: t.coverageCommitment };
}

/**
 * Parse a ticket from a tx's JSON metadata, in either the Koios shape
 * (`{ "7731": {...} }`) or the Blockfrost shape (`[{ label: "7731", json_metadata: {...} }]`).
 * Returns null when there is none or it is malformed (never throws).
 */
export function parseTicket(metadata: unknown): RegistrationTicket | null {
  let v: unknown = null;
  if (Array.isArray(metadata)) v = metadata.find((m) => String((m as { label?: unknown })?.label) === String(MIDNIGHT_TICKET_LABEL))?.json_metadata ?? null;
  else if (metadata && typeof metadata === "object") v = (metadata as Record<string, unknown>)[String(MIDNIGHT_TICKET_LABEL)] ?? null;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (Number(o.v) !== MIDNIGHT_TICKET_VERSION) return null;
  const t = { policyId: String(o.p ?? "").toLowerCase(), holderCommitment: String(o.h ?? "").toLowerCase(), coverageCommitment: String(o.c ?? "").toLowerCase() };
  return HEX32.test(t.policyId) && HEX32.test(t.holderCommitment) && HEX32.test(t.coverageCommitment) ? t : null;
}

/** A ticket is usable only if it is for this policy and opens the datum's midnight_commitment. */
export async function ticketOpensDatum(t: RegistrationTicket, datum: { policyId: string; midnightCommitment: string }): Promise<boolean> {
  if (t.policyId !== datum.policyId.toLowerCase()) return false;
  const r = await registrationCommitment(t.policyId, t.holderCommitment, t.coverageCommitment);
  return toHex(r) === datum.midnightCommitment.toLowerCase();
}

/**
 * Where a Cardano policy stands on Midnight:
 *  - mirrored      registered in policy-cover (id is in the public policies map)
 *  - ready         not yet registered, and a verified ticket or local key opens the datum: the relay can register it
 *  - awaiting-key  bound policy, but neither a ticket nor the holder's key is available to the relay
 *  - pre-binding   bought before the Midnight binding; the placeholder commitment can't be registered
 */
export type MirrorState = "mirrored" | "ready" | "awaiting-key" | "pre-binding";

export interface MirrorInput {
  policyId: string;
  midnightCommitment: string;
  /** Block time of the Buy (ms or s since epoch), if known. */
  blockTime?: number | null;
  mirrored: boolean;
  ticket?: RegistrationTicket | null;
  /** A local policy key that already passed checkPolicyKey against this datum. */
  keyOpensDatum?: boolean;
}

export interface MirrorPlanEntry {
  policyId: string;
  state: MirrorState;
  /** How the relay can register it (only for "ready", or how a mirrored one was relayable). */
  source: "ticket" | "key" | null;
  /** Whether the relay can also run proveCover (holder key available locally). */
  canProve: boolean;
  /** The ticket was present but did not open the datum (reported, never used). */
  badTicket: boolean;
}

/** Normalise Koios (seconds) / Blockfrost (seconds) / JS (ms) block times to ms. */
export const blockTimeMs = (t: number | null | undefined) => (t == null ? null : t < 1e12 ? t * 1000 : t);

export async function classifyMirror(p: MirrorInput): Promise<MirrorPlanEntry> {
  const ticketOk = p.ticket ? await ticketOpensDatum(p.ticket, p) : false;
  const key = !!p.keyOpensDatum;
  const source = key ? "key" : ticketOk ? "ticket" : null;
  const base = { policyId: p.policyId.toLowerCase(), source, canProve: key, badTicket: !!p.ticket && !ticketOk } as const;
  if (p.mirrored) return { ...base, state: "mirrored" };
  if (source) return { ...base, state: "ready" };
  const t = blockTimeMs(p.blockTime);
  if (t != null && t < MIDNIGHT_BINDING_SINCE_MS) return { ...base, state: "pre-binding" };
  return { ...base, state: "awaiting-key" };
}

export const MIRROR_STATE_LABEL: Record<MirrorState, string> = {
  mirrored: "Mirrored on Midnight",
  ready: "Relay pending",
  "awaiting-key": "Awaiting holder key",
  "pre-binding": "Pre-binding (can't mirror)",
};

/** Count entries per state, e.g. for "3 of 11 mirrored". */
export function mirrorSummary(entries: Pick<MirrorPlanEntry, "state">[]) {
  const n: Record<MirrorState, number> = { mirrored: 0, ready: 0, "awaiting-key": 0, "pre-binding": 0 };
  for (const e of entries) n[e.state]++;
  return { total: entries.length, ...n, mirrorable: entries.length - n["pre-binding"] };
}
