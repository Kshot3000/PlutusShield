/**
 * The Wave 2 guided demo: the same five beats as docs/buildathon/VIDEO_SCRIPT.md,
 * with every on-chain reference taken from the public deployment records:
 *   contracts/cardano/deploy/deployments/preview.json          (Buy, oracle publishes)
 *   contracts/cardano/deploy/deployments/preview-exploit-v2.json (exploit Buy, 2-of-3 Settle)
 *   contracts/midnight/deployments/preprod-v2.json              (v2 contract, registerPolicy,
 *                                                                proveCover, fileClaim, voteClaim)
 * All links were checked on Oct 12, 2026 (Koios confirms the Preview txs; the
 * Midnight explorer resolves the Preprod hashes). Public data only, no keys.
 */
import { midnightExplorerContract, midnightExplorerTx } from "./midnightPreprod";

export type DemoChain = "cardano" | "midnight" | "both";

export type DemoProof = {
  chain: "cardano" | "midnight";
  kind: "tx" | "contract";
  label: string;
  hash: string;
  note?: string;
};

export type DemoCta = { href: string; label: string; external?: boolean };

export type DemoBeat = {
  id: string;
  time: string;
  chain: DemoChain;
  route: string;
  title: string;
  lede: string;
  steps: string[];
  proves: string;
  ctas: DemoCta[];
  proofs: DemoProof[];
  honest?: string;
};

export const CARDANO_PREVIEW_EXPLORER = "https://preview.cexplorer.io";

export function proofHref(p: DemoProof): string | null {
  if (p.chain === "cardano") return `${CARDANO_PREVIEW_EXPLORER}/tx/${p.hash}`;
  return p.kind === "contract" ? midnightExplorerContract(p.hash) : midnightExplorerTx(p.hash);
}

export const DEMO_CHECKED = "Oct 12, 2026";

export const MIDNIGHT_V2_CONTRACT = "5430b803b6b3df6e6ee1d498bb02e2f2d06cb46661e72af1e6208d864feb8110";

/** Latest oracle publish recorded in preview.json at the time of this build. */
export const LATEST_ORACLE = {
  hash: "b2e0fbe6efef3a5fdad0b135f6968172ff509e0ddcf7c61f6205de4b5ab81b29",
  pegBps: 9977,
  at: "Oct 12, 2026 · 14:11 UTC",
};

export const REPO = "https://github.com/Kshot3000/PlutusShield";
export const KIT = {
  deck: `${REPO}/blob/main/docs/buildathon/PlutusShield-Wave2-deck.pdf`,
  script: `${REPO}/blob/main/docs/buildathon/VIDEO_SCRIPT.md`,
  readme: `${REPO}#midnight-buildathon`,
};

/** Three links that prove the dual-chain story on their own. */
export const FAST_LANE: DemoProof[] = [
  {
    chain: "midnight",
    kind: "contract",
    label: "policy-cover v2 contract",
    hash: MIDNIGHT_V2_CONTRACT,
    note: "Midnight Preprod · 2-of-3 committee registry",
  },
  {
    chain: "midnight",
    kind: "tx",
    label: "proveCover",
    hash: "853bab79c11f0a5ea42ff46121efc60e32b74fe5ca07b18761b71a6f442c39ce",
    note: "Midnight Preprod · ZK proof of ≥ 50 tADA cover",
  },
  {
    chain: "cardano",
    kind: "tx",
    label: "2-of-3 Settle payout",
    hash: "c35535dd089693d5b9676d5569a8d31b405726f7d02f782647d6afa67899ab38",
    note: "Cardano Preview · 50 tADA, two assessor signatures",
  },
];

export const DEMO_BEATS: DemoBeat[] = [
  {
    id: "landing",
    time: "0:00 – 0:20",
    chain: "both",
    route: "/",
    title: "The problem, and the split",
    lede:
      "To get covered on a public chain you publish who you are, what you hold and how much you insured. To claim, you publish your evidence. PlutusShield splits the job: Cardano holds the money and pays out, Midnight keeps the secrets.",
    steps: [
      "Open the landing page and read the hero.",
      "Scroll to the dual-chain section: Cardano for premiums, pool capital and payouts; Midnight for policy terms, positions and claim evidence.",
    ],
    proves: "Neither chain is asked to do the other's job. Settlement stays public and auditable; sensitive terms stay private.",
    ctas: [
      { href: "/", label: "Open the landing page" },
      { href: "/#dual-chain", label: "Jump to the architecture" },
    ],
    proofs: [
      {
        chain: "cardano",
        kind: "tx",
        label: "InitPool (depeg pool)",
        hash: "fc2a3ca252051a41589f58b612e08427b512a2cf17e0b3fa5a53500f162ca236",
        note: "Cardano Preview · ADA + tUSDCx tranches",
      },
      {
        chain: "midnight",
        kind: "contract",
        label: "policy-cover v2 contract",
        hash: MIDNIGHT_V2_CONTRACT,
        note: "Midnight Preprod · compactc 0.31.1",
      },
    ],
  },
  {
    id: "buy",
    time: "0:20 – 0:55",
    chain: "cardano",
    route: "/cover",
    title: "Buy cover on Cardano",
    lede:
      "The cover desk runs on Cardano Preview. Pick stablecoin depeg cover, pay the premium in ADA or test USDC, and sign with your own wallet. The validator only sells while the oracle feeds are fresh and the peg holds: if the feeds go stale for two hours or the peg breaks, sales close on their own.",
    steps: [
      "Connect a CIP-30 wallet (Lace or Eternl) on Preview with a little tADA.",
      "Choose depeg cover, set an amount, pick ADA or tUSDCx for the premium, and buy.",
      "Open the Buy tx: the policy datum holds a hash commitment, not your terms.",
      "No wallet handy? Skip the buy and look at a live policy on the app dashboard.",
    ],
    proves: "Premium, pool accounting and the sale circuit-breaker are enforced by the validator, not by the website.",
    ctas: [
      { href: "/cover", label: "Buy cover" },
      { href: "/claim", label: "Check the oracle trigger" },
    ],
    proofs: [
      {
        chain: "cardano",
        kind: "tx",
        label: "Buy · 50 tADA depeg cover, 14 days",
        hash: "7c3365bb519dfdaca6e12a371b35e0c1b7ffd321bec42130021e22b47c31386d",
        note: "Policy 72512fac…, the one mirrored on Midnight in the next step",
      },
      {
        chain: "cardano",
        kind: "tx",
        label: `Latest oracle publish · peg ${(LATEST_ORACLE.pegBps / 100).toFixed(2)}%`,
        hash: LATEST_ORACLE.hash,
        note: LATEST_ORACLE.at,
      },
    ],
  },
  {
    id: "prove",
    time: "0:55 – 1:35",
    chain: "midnight",
    route: "/app",
    title: "Mirrored privately on Midnight",
    lede:
      "A relay mirrors the policy to Midnight Preprod. registerPolicy stores a commitment to the holder and the terms. Then the holder runs proveCover: a zero-knowledge proof that says “this policy covers at least X” without revealing the real limit or the wallet behind it.",
    steps: [
      "Open the app dashboard and find the Midnight panel for policy-cover v2.",
      "Follow the policy into the contract on the Midnight explorer.",
      "Open the proveCover tx: it proves the cover floor, nothing more.",
    ],
    proves: "A protocol or counterparty can check that you are covered. Nobody learns your position.",
    ctas: [{ href: "/app", label: "Open the Midnight panels" }],
    proofs: [
      {
        chain: "midnight",
        kind: "tx",
        label: "registerPolicy · policy 72512fac…",
        hash: "2e0f69b76065d4f5e3e796d57ba57ce65b74cdacfbcdac55363ec26fb181eed0",
        note: "Commitment bound to the Cardano Buy above",
      },
      {
        chain: "midnight",
        kind: "tx",
        label: "proveCover · ≥ 50 tADA",
        hash: "853bab79c11f0a5ea42ff46121efc60e32b74fe5ca07b18761b71a6f442c39ce",
        note: "Zero-knowledge coverage proof",
      },
    ],
    honest: "Today the relay and proveCover run from the operator tooling. Proving straight from a browser Midnight wallet is next.",
  },
  {
    id: "claim",
    time: "1:35 – 2:15",
    chain: "midnight",
    route: "/claim/evidence",
    title: "Sealed evidence, committee decision",
    lede:
      "Exploit cover can't pay out from an oracle, so claims get assessed. The evidence is encrypted in your browser with AES-256-GCM. Only its SHA-256 commitment goes into fileClaim on Midnight; the file goes privately to the assessors. Three committee seats vote with voteClaim, and at two approvals the claim is marked PAID.",
    steps: [
      "On the evidence vault, press “Fill with example data” and seal the bundle.",
      "Note the commitment: that 32-byte value is all the ledger ever sees.",
      "Scroll to the committee panel: approve, reject, approve, then PAID at 2 of 3.",
    ],
    proves: "Claimants can't swap evidence after filing, and the public ledger never sees it.",
    ctas: [{ href: "/claim/evidence", label: "Seal example evidence" }],
    proofs: [
      {
        chain: "midnight",
        kind: "tx",
        label: "fileClaim · evidence commitment only",
        hash: "96e17dfad21b4f59a5d2019945a54ed79e0d35feb39a91cd21d356444841c6c0",
        note: "Drill claim on policy 7c24be86… (demo data, no real incident)",
      },
      {
        chain: "midnight",
        kind: "tx",
        label: "voteClaim · seat 1 approves",
        hash: "db60e9d7e73cfe5e5af12733b1635e679270bcd075fcc0536345fa64fd2dfc4e",
      },
      {
        chain: "midnight",
        kind: "tx",
        label: "voteClaim · seat 2 rejects",
        hash: "b027116544d495267dc124511d003297c87c36f024aa570ec3474d24cf0cedfc",
      },
      {
        chain: "midnight",
        kind: "tx",
        label: "voteClaim · seat 3 approves → PAID",
        hash: "bd62e689f13326a71d8db92f88d6aa4d7ede55952be32bbaf8440ec0482f7d74",
      },
    ],
    honest: "The page seals the bundle and shows the exact fileClaim arguments; filing from a browser Midnight wallet is next.",
  },
  {
    id: "settle",
    time: "2:15 – 2:40",
    chain: "cardano",
    route: "/app",
    title: "Payout on Cardano, 2 of 3",
    lede:
      "The decision comes back to Cardano. The exploit pool's validator only releases funds through a Settle carrying two of the three assessor signatures. This Settle paid 50 test ADA, signed by assessor 1 and assessor 3. A one-of-three Settle is rejected, so no single key can push money out.",
    steps: [
      "Open the Settle tx on the Cardano Preview explorer.",
      "Check the two required signers and the 50 tADA payout.",
    ],
    proves: "Money moves only when the committee threshold is met, on both chains.",
    ctas: [
      { href: "/app", label: "See the committee counters" },
      { href: "/docs/settlement#assessed", label: "How assessed claims settle" },
    ],
    proofs: [
      {
        chain: "cardano",
        kind: "tx",
        label: "Buy · 50 tADA exploit cover",
        hash: "4ed985795772f8c8df2f1867d5f1754c2d66af6e44ca3ea541aa0c942a9a77e4",
        note: "Exploit-cover pool v2 (2-of-3 committee)",
      },
      {
        chain: "cardano",
        kind: "tx",
        label: "Settle · 50 tADA paid, 2 of 3 signatures",
        hash: "c35535dd089693d5b9676d5569a8d31b405726f7d02f782647d6afa67899ab38",
        note: "assessor-1 + assessor-3",
      },
    ],
    honest:
      "This payout drill (Oct 7) settled a claim approved on the v1 Midnight registry; v2 now enforces the same 2-of-3 rule on Midnight's side. Cardano can't verify Midnight on-chain, so the committee's signatures are the trust point.",
  },
];
