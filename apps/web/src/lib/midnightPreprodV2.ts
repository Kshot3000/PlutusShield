/**
 * policy-cover v2 on Midnight Preprod: the same private registry as v1 with
 * claims decided by an M-of-3 assessor committee (voteClaim), matching the
 * Cardano exploit-cover v2 Settle. Mirrored from
 * contracts/midnight/deployments/preprod-v2.json, which the Preprod relay
 * (`run-v2.sh`, PLUTUSSHIELD_COVER_VERSION=2) writes from finalized tx data
 * only. Public values: committee commitments, tx ids, ledger tallies. No keys.
 */
import record from "@/data/midnight-preprod-v2.json";

type Tx = { txId?: string; txHash?: string | null; blockHeight?: number | null };

export interface CommitteeVote {
  seat: number;
  member: string;
  approved: boolean;
  txHash: string;
  block: number | null;
  statusAfter: string;
  approvals: number;
  rejections: number;
}

export interface CommitteeClaim {
  policyId: string;
  buyTx: string | null;
  evidenceCommitment: string;
  fileClaim: { txHash: string; block: number | null } | null;
  votes: CommitteeVote[];
  decided: string | null;
}

type RawVote = Tx & { seat: number; member: string; approved: boolean; ledgerAfterVote?: { status?: string; approvals?: number; rejections?: number } };
type RawClaim = {
  policyId: string;
  cardano?: { buyTx?: string };
  evidenceCommitment: string;
  fileClaim?: Tx;
  votes?: RawVote[];
  decided?: { status: string };
};
type Raw = {
  network: string;
  contract: string;
  compiler: string;
  contractAddress: string | null;
  deployTxId?: string | null;
  blockHeight?: number | null;
  committee: string[];
  threshold: number;
  registrations?: { policyId: string; registerPolicy?: Tx; proveCover?: Tx }[];
  claims?: RawClaim[];
};

const r = record as unknown as Raw;
const hashOf = (t?: Tx) => String(t?.txHash ?? t?.txId ?? "");

export const MIDNIGHT_V2 = {
  network: "Midnight Preprod",
  contract: r.contract,
  compiler: r.compiler,
  live: !!r.contractAddress,
  contractAddress: r.contractAddress,
  deployTxId: r.deployTxId ?? null,
  deployBlock: r.blockHeight ?? null,
  committee: r.committee.map((c, seat) => ({ seat, commitment: c })),
  threshold: r.threshold,
  quorumLabel: `${r.threshold}-of-${r.committee.length}`,
  registrations: (r.registrations ?? []).map((x) => ({
    policyId: x.policyId,
    registerPolicy: x.registerPolicy ? { txHash: hashOf(x.registerPolicy), block: x.registerPolicy.blockHeight ?? null } : null,
    proveCover: x.proveCover ? { txHash: hashOf(x.proveCover), block: x.proveCover.blockHeight ?? null } : null,
  })),
  claims: (r.claims ?? []).map(
    (c): CommitteeClaim => ({
      policyId: c.policyId,
      buyTx: c.cardano?.buyTx ?? null,
      evidenceCommitment: c.evidenceCommitment,
      fileClaim: c.fileClaim ? { txHash: hashOf(c.fileClaim), block: c.fileClaim.blockHeight ?? null } : null,
      votes: (c.votes ?? []).map((v) => ({
        seat: v.seat,
        member: v.member,
        approved: v.approved,
        txHash: hashOf(v),
        block: v.blockHeight ?? null,
        statusAfter: v.ledgerAfterVote?.status ?? "CLAIM_PENDING",
        approvals: v.ledgerAfterVote?.approvals ?? 0,
        rejections: v.ledgerAfterVote?.rejections ?? 0,
      })),
      decided: c.decided?.status ?? null,
    }),
  ),
  record: "https://github.com/Kshot3000/PlutusShield/blob/main/contracts/midnight/deployments/preprod-v2.json",
  source: "https://github.com/Kshot3000/PlutusShield/blob/main/contracts/midnight/src/policy-cover-v2.compact",
};
