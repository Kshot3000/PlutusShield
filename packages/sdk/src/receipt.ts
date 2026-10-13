/**
 * Premium receipt: a printable / downloadable Buy proof built from a policy
 * record so a holder or judge can prove the Cardano Preview premium payment
 * without trusting marketing copy.
 *
 * Pure and deterministic: the caller passes every time (including `issuedAt`
 * or `boughtAt`), so the same payment always produces byte-identical Markdown.
 * No wallet, no network. Mirrors certificate.ts honesty style.
 *
 * Determinism rule for Issued: `issuedAt` if provided, else `boughtAt`. At
 * least one of `boughtAt` or `issuedAt` must be a positive ms timestamp so the
 * output never depends on wall-clock time.
 */

import { certTime } from "./certificate.ts";

export type ReceiptProduct = "depeg" | "exploit";

export interface PremiumReceiptInput {
  /** 64-hex policy id (0x prefix and case ignored). */
  policyId: string;
  product: ReceiptProduct;
  /** Coverage label, e.g. "250 tUSDCx". */
  coverage: string;
  /** Premium paid label, e.g. "5 ADA". Required for a receipt. */
  premium: string;
  /** Covered asset or risk ticker, e.g. "USDM" or "tUSDCx". */
  asset?: string | null;
  /** Premium asset label, e.g. "ADA" / "tUSDCx". */
  premiumAsset?: string | null;
  /** ms since epoch: when the Buy landed. */
  boughtAt?: number | null;
  /** e.g. "Cardano Preview" */
  network: string;
  /** Pool script address or a short pool label. */
  pool?: string | null;
  /** Tranche label, e.g. "ADA tranche 0". */
  tranche?: string | null;
  /** 64-hex Cardano Buy tx hash (0x prefix and case ignored). */
  buyTx: string;
  /** Absolute explorer URL for the Buy tx. */
  buyExplorerUrl: string;
  /** Optional Midnight commitment hex (0x optional). */
  midnightCommitment?: string | null;
  /** Absolute URL of the policy tracker page. */
  trackerUrl: string;
  /** Absolute URL of the cover wording / terms page. */
  termsUrl: string;
  /**
   * ms since epoch written as Issued. Defaults to `boughtAt`. At least one of
   * `boughtAt` or `issuedAt` is required (deterministic fallback — never Date.now()).
   */
  issuedAt?: number;
}

export interface ReceiptRow {
  label: string;
  value: string;
}

export interface PremiumReceipt {
  title: string;
  subtitle: string;
  product: ReceiptProduct;
  productLabel: string;
  policyId: string;
  policyIdShort: string;
  coverage: string;
  premium: string;
  premiumAsset: string | null;
  asset: string | null;
  network: string;
  pool: string | null;
  tranche: string | null;
  buyTx: string;
  buyExplorerUrl: string;
  midnightCommitment: string | null;
  boughtAt: number | null;
  trackerUrl: string;
  termsUrl: string;
  issuedAt: number;
  rows: ReceiptRow[];
  disclaimers: string[];
}

const PRODUCT_LABEL: Record<ReceiptProduct, string> = {
  depeg: "USDM depeg cover",
  exploit: "Smart-contract exploit cover",
};

const normId = (id: string, name = "policyId") => {
  const h = id.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error(`${name} must be 64 hex characters`);
  return h;
};

const checkTime = (name: string, ms: number) => {
  if (!Number.isFinite(ms) || ms <= 0) throw new Error(`${name} must be a positive ms timestamp`);
};

/**
 * Build a structured Premium receipt from a Buy payment record. Throws on a
 * bad policy id, buy tx, empty premium/coverage, or missing boughtAt/issuedAt.
 */
export function buildPremiumReceipt(input: PremiumReceiptInput): PremiumReceipt {
  const id = normId(input.policyId);
  const buyTx = normId(input.buyTx, "buyTx");

  const coverage = String(input.coverage ?? "").trim();
  if (!coverage) throw new Error("coverage is required");
  const premium = String(input.premium ?? "").trim();
  if (!premium) throw new Error("premium is required");

  const buyExplorerUrl = String(input.buyExplorerUrl ?? "").trim();
  if (!buyExplorerUrl || !/^https?:\/\//i.test(buyExplorerUrl)) {
    throw new Error("buyExplorerUrl must be an absolute http(s) URL");
  }
  const trackerUrl = String(input.trackerUrl ?? "").trim();
  if (!trackerUrl) throw new Error("trackerUrl is required");
  const termsUrl = String(input.termsUrl ?? "").trim();
  if (!termsUrl) throw new Error("termsUrl is required");

  if (input.boughtAt != null) checkTime("boughtAt", input.boughtAt);
  const issuedAt = input.issuedAt ?? input.boughtAt ?? null;
  if (issuedAt == null) throw new Error("boughtAt or issuedAt is required for a deterministic receipt");
  checkTime("issuedAt", issuedAt);

  const productLabel = PRODUCT_LABEL[input.product];
  const short = `${id.slice(0, 8)}…${id.slice(-4)}`;
  const asset = input.asset?.trim() ? input.asset.trim() : null;
  const premiumAsset = input.premiumAsset?.trim() ? input.premiumAsset.trim() : null;
  const pool = input.pool?.trim() ? input.pool.trim() : null;
  const tranche = input.tranche?.trim() ? input.tranche.trim() : null;
  const midnightCommitment = input.midnightCommitment?.trim()
    ? input.midnightCommitment.trim().toLowerCase().replace(/^0x/, "")
    : null;
  const boughtAt = input.boughtAt ?? null;

  const rows: ReceiptRow[] = [
    { label: "Product", value: productLabel },
    { label: "Policy id", value: id },
    { label: "Coverage", value: coverage },
    { label: "Premium paid", value: premium },
  ];
  if (premiumAsset) rows.push({ label: "Premium asset", value: premiumAsset });
  if (asset) rows.push({ label: "Asset", value: asset });
  if (boughtAt != null) rows.push({ label: "Bought at", value: certTime(boughtAt) });
  rows.push(
    { label: "Buy transaction", value: buyTx },
    { label: "Explorer", value: buyExplorerUrl },
  );
  if (pool) rows.push({ label: "Pool", value: pool });
  if (tranche) rows.push({ label: "Tranche", value: tranche });
  rows.push({ label: "Network", value: `${input.network} (testnet; not audited)` });
  if (midnightCommitment) rows.push({ label: "Midnight commitment", value: midnightCommitment });
  rows.push(
    { label: "Policy tracker", value: trackerUrl },
    { label: "Cover wording", value: termsUrl },
    { label: "Issued", value: certTime(issuedAt) },
  );

  const disclaimers = [
    "This is a Premium receipt for a PlutusShield testnet Buy. It is not a regulated insurance policy, a financial product, or a guarantee of future payout.",
    "It proves only the Buy payment facts you pass in (policy id, premium, coverage, Buy tx). Payout still depends on on-chain validators and, as applicable, the oracle quorum or assessor committee.",
    `${input.network} only. Contracts are not audited. Test value only.`,
    "Built in the browser from the policy record; nothing is uploaded to PlutusShield to produce this file.",
  ];

  return {
    title: "Premium receipt",
    subtitle: `PlutusShield · ${productLabel} · ${short}`,
    product: input.product,
    productLabel,
    policyId: id,
    policyIdShort: short,
    coverage,
    premium,
    premiumAsset,
    asset,
    network: input.network,
    pool,
    tranche,
    buyTx,
    buyExplorerUrl,
    midnightCommitment,
    boughtAt,
    trackerUrl,
    termsUrl,
    issuedAt,
    rows,
    disclaimers,
  };
}

/** Plain Markdown suitable for download / print (deterministic). */
export function premiumReceiptMarkdown(receipt: PremiumReceipt): string {
  const lines = [
    `# ${receipt.title}`,
    "",
    receipt.subtitle,
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...receipt.rows.map((r) => `| ${r.label.replace(/\|/g, "\\|")} | ${r.value.replace(/\|/g, "\\|")} |`),
    "",
    "## Disclaimers",
    "",
    ...receipt.disclaimers.map((d) => `- ${d}`),
    "",
    "---",
    "",
    "PlutusShield · Cardano Preview + Midnight Preprod · https://kshot3000.github.io/PlutusShield/",
    "",
  ];
  return lines.join("\n");
}

/** Suggested download name: plutusshield-receipt-<first 8 hex>.md */
export const premiumReceiptFilename = (policyId: string) =>
  `plutusshield-receipt-${normId(policyId).slice(0, 8)}.md`;

/** Plain text for a print dialog (same facts, no Markdown table). */
export function premiumReceiptPlainText(receipt: PremiumReceipt): string {
  const lines = [
    receipt.title,
    receipt.subtitle,
    "",
    ...receipt.rows.map((r) => `${r.label}: ${r.value}`),
    "",
    "Disclaimers",
    ...receipt.disclaimers.map((d) => `- ${d}`),
    "",
  ];
  return lines.join("\n");
}
