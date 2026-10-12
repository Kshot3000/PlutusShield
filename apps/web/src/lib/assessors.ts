/**
 * /assessors: how an independent assessor joins the 2-of-3 claims committee.
 *
 * Committee facts come from the public deployment records the rest of the site
 * already mirrors (no keys):
 *   contracts/cardano/deploy/deployments/preview-exploit-v2.json  (Cardano Preview committee key hashes)
 *   contracts/midnight/deployments/preprod-v2.json                (Midnight Preprod seat commitments, votes)
 * Kit commands are the real ones in contracts/committee/cli.ts (checked against
 * a clean checkout on Oct 12, 2026: no npm install needed).
 */
import { CARDANO_PREVIEW_EXPLORER } from "./demoWalkthrough";
import { EXPLOIT_PREVIEW } from "./exploitPreview";
import { midnightExplorerContract, midnightExplorerTx } from "./midnightPreprod";
import { MIDNIGHT_V2 } from "./midnightPreprodV2";
import { REPO } from "./status";

export const KIT_DIR = `${REPO}/tree/main/contracts/committee`;
export const KIT_README = `${REPO}/blob/main/contracts/committee/README.md`;
export const KIT_CLI = `${REPO}/blob/main/contracts/committee/cli.ts`;
export const KIT_LIB = `${REPO}/blob/main/contracts/committee/lib/kit.ts`;
export const KIT_TESTS = `${REPO}/blob/main/contracts/committee/test/kit.test.ts`;
export const RELAY_SRC = `${REPO}/blob/main/contracts/midnight/preprod/policy-cover-preprod.mjs`;
export const ENROLL_ISSUE = `${REPO}/issues/new?title=${encodeURIComponent("Assessor enrollment: @your-handle")}&body=${encodeURIComponent(
  "Paste the contents of your public enrollment.json below (never the .sk, .skey or midnight-seat.json files).\n\n```json\n\n```\n",
)}`;

export const cardanoTxHref = (hash: string) => `${CARDANO_PREVIEW_EXPLORER}/tx/${hash}`;
export const cardanoAddressHref = (addr: string) => `${CARDANO_PREVIEW_EXPLORER}/address/${addr}`;

/** The current (team-run) committee on both chains, seat by seat. */
export const COMMITTEE = {
  threshold: EXPLOIT_PREVIEW.committee.threshold,
  size: EXPLOIT_PREVIEW.committee.size,
  cardano: {
    scriptHash: EXPLOIT_PREVIEW.scriptHash,
    address: EXPLOIT_PREVIEW.address,
    record: EXPLOIT_PREVIEW.record,
    validator: EXPLOIT_PREVIEW.validator,
    quorumLabel: EXPLOIT_PREVIEW.quorumLabel,
    initTx: EXPLOIT_PREVIEW.initTx,
  },
  midnight: {
    contractAddress: MIDNIGHT_V2.contractAddress,
    contractHref: MIDNIGHT_V2.contractAddress ? midnightExplorerContract(MIDNIGHT_V2.contractAddress) : null,
    record: MIDNIGHT_V2.record,
    source: MIDNIGHT_V2.source,
    quorumLabel: MIDNIGHT_V2.quorumLabel,
  },
  seats: EXPLOIT_PREVIEW.committee.assessors.map((a, i) => ({
    seat: i,
    name: `assessor-${a.index}`,
    cardanoKeyHash: a.keyHash,
    cardanoAddress: a.address,
    midnightCommitment: MIDNIGHT_V2.committee[i]?.commitment ?? null,
    operator: "PlutusShield team",
  })),
};

/** The first committee drill: one claim decided on Midnight by voteClaim, one Cardano payout co-signed by two seats. */
const payout = EXPLOIT_PREVIEW.policies.find((p) => p.settleTx && p.signedBy?.length);
const midnightClaim = MIDNIGHT_V2.claims.find((c) => c.decided === "PAID" && c.votes.length);

export const FIRST_DRILL = {
  cardano: payout
    ? {
        policyId: payout.policyId,
        settleTx: payout.settleTx!,
        href: cardanoTxHref(payout.settleTx!),
        payout: payout.payout,
        signedBy: payout.signedBy!.map((s) => s.name),
      }
    : null,
  midnight: midnightClaim
    ? {
        policyId: midnightClaim.policyId,
        fileClaim: midnightClaim.fileClaim
          ? { ...midnightClaim.fileClaim, href: midnightExplorerTx(midnightClaim.fileClaim.txHash) }
          : null,
        votes: midnightClaim.votes.map((v) => ({ ...v, href: midnightExplorerTx(v.txHash) })),
        decided: midnightClaim.decided,
      }
    : null,
};

export type KitStep = {
  n: string;
  title: string;
  body: string;
  cmd: string;
  note?: string;
};

export const KIT_STEPS: KitStep[] = [
  {
    n: "01",
    title: "Get the kit",
    body: "A plain checkout is enough. The kit is offline and has no npm dependencies: Node built-ins plus the PlutusShield SDK source.",
    cmd: "git clone https://github.com/Kshot3000/PlutusShield && cd PlutusShield",
    note: "Node 22.6+. No pnpm? Use `node --experimental-strip-types --no-warnings contracts/committee/cli.ts` in place of `pnpm committee`.",
  },
  {
    n: "02",
    title: "Generate your seat, on your machine",
    body: "A fresh Cardano Preview assessor key and a Midnight Preprod seat secret, written 0600 into a 0700 directory, plus a public enrollment record signed by the Cardano key.",
    cmd: "pnpm committee keygen --out ~/plutusshield-assessor --handle @you --affiliation ExampleDEX",
    note: "`--affiliation` is repeatable: list every protocol you work for or hold a position in, so conflicts are visible. `keygen` never overwrites an existing identity.",
  },
  {
    n: "03",
    title: "Self-check",
    body: "Re-derives your key hash and address, checks the ed25519 signature and encodings, and confirms your local secret files open the record.",
    cmd: "pnpm committee verify ~/plutusshield-assessor/enrollment.json --secrets ~/plutusshield-assessor",
  },
  {
    n: "04",
    title: "Share only enrollment.json",
    body: "It carries your handle, Cardano vkey, key hash and address, and your Midnight seat commitment: nothing secret. The team verifies it and confirms your handle out of band, then assigns a seat.",
    cmd: "pnpm committee seat --dir ~/plutusshield-assessor --seat 1",
    note: "Relabels your local seat file so it matches the relay's `member-<n>.json`. The commitment does not change.",
  },
  {
    n: "05",
    title: "Agree on the plan",
    body: "With three records, every operator builds the same dry run: the exploit-cover `Committee` parameter and its CBOR, the policy-cover-v2 constructor args, a diff against today's team-run seats, and a `planSha256` to compare before anything is deployed.",
    cmd: "pnpm committee plan a.json b.json c.json --threshold 2 --out plan.json",
  },
];

export const KIT_FILES = [
  { file: "cardano-assessor.sk", secret: true, what: "Cardano Preview signing key (bech32 ed25519_sk)" },
  { file: "cardano-assessor.skey", secret: true, what: "Same key as a cardano-cli TextEnvelope" },
  { file: "midnight-seat.json", secret: true, what: "Midnight Preprod committee seat secret" },
  { file: "cardano-assessor.vkey", secret: false, what: "Verification key" },
  { file: "enrollment.json", secret: false, what: "Signed public record: share this one" },
];

export type Duty = { chain: "cardano" | "midnight" | "both"; title: string; body: string; code?: string; link?: { href: string; label: string } };

export const DUTIES: Duty[] = [
  {
    chain: "both",
    title: "Receive the sealed evidence",
    body: "The claimant seals the bundle in their browser and files only a 32-byte commitment on Midnight. The encrypted bundle and its key file reach the committee privately, never on a public channel.",
    link: { href: "/claim/evidence", label: "How evidence is sealed" },
  },
  {
    chain: "midnight",
    title: "Verify it against the ledger",
    body: "Open the bundle yourself and check it hashes to the evidence commitment the Midnight registry holds for that policy. Any edited byte fails. Recuse if you have a conflict.",
    link: { href: "/claim/evidence#assessor-title", label: "Open the verifier" },
  },
  {
    chain: "midnight",
    title: "Vote on Midnight",
    body: "`voteClaim` proves in zero knowledge that you hold your seat's secret; the secret never leaves your machine. Votes are public and attributable to the seat, one per seat per claim round, and the claim flips to PAID at two approvals.",
    code: "policy-cover-preprod.mjs --vote <policyId> --member <seat> --approve",
  },
  {
    chain: "cardano",
    title: "Co-sign the Cardano Settle",
    body: "Only after Midnight shows the claim PAID. The Settle carries the Midnight decision tx in its metadata (label 7732), and the validator pays only with two distinct committee signatures.",
    link: { href: "/docs/settlement#assessed", label: "Assessed claim flow" },
  },
];

export const RUNBOOK = [
  "Three operators enroll and share their records.",
  "The team verifies each record and confirms each handle out of band.",
  "All three re-run the plan on the same records and match planSha256.",
  "Redeploy: a new exploit-cover pool on Cardano Preview, a new policy-cover-v2 contract on Midnight Preprod.",
  "Drill: one test claim, each seat votes from its own machine, two seats co-sign the Settle.",
  "Retire the team-run committee. Today's pool and contract stay readable as history.",
];
