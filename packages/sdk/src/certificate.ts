/**
 * Coverage certificate: a printable / downloadable Certificate of Cover built
 * from a policy record and the deployment's own params, so a holder or judge
 * can prove what was bought without trusting marketing copy.
 *
 * Pure and deterministic: the caller passes every time (including `issuedAt`),
 * so the same policy always produces byte-identical Markdown. No wallet, no
 * network. Mirrors the honesty style of wording.ts and calendar.ts.
 */

export type CertificateProduct = "depeg" | "exploit";

export interface CoverageCertificateInput {
  /** 64-hex policy id (0x prefix and case ignored). */
  policyId: string;
  product: CertificateProduct;
  /** Coverage label, e.g. "250 tUSDCx". */
  coverage: string;
  /** Premium label, e.g. "5 ADA". Omit or null when unknown. */
  premium?: string | null;
  /** Covered asset or risk ticker, e.g. "USDM" or "tUSDCx". */
  asset?: string | null;
  /** ms since epoch: cover becomes active. Null when unknown. */
  start: number | null;
  /** ms since epoch: cover ends. */
  expiry: number;
  /** ms after expiry that a claim may still be filed. */
  claimGraceMs: number;
  /** e.g. "Cardano Preview" */
  network: string;
  /** Pool script address or a short pool label. */
  pool?: string | null;
  /** Optional Midnight commitment hex (0x optional). */
  midnightCommitment?: string | null;
  /** Absolute URL of the policy tracker page. */
  trackerUrl: string;
  /** Absolute URL of the cover wording / terms page. */
  termsUrl: string;
  /** Absolute URL where the holder files a claim. */
  claimUrl: string;
  /** ms since epoch written as Issued. Defaults to `expiry` so output stays deterministic. */
  issuedAt?: number;
  /** Waiting period before cover starts, for the schedule row. Optional. */
  waitingPeriodMs?: number | null;
  /** What pays: e.g. "USDM peg below 95% for 24 h (2-of-3 oracle feeds)". */
  trigger?: string | null;
}

export interface CertificateRow {
  label: string;
  value: string;
}

export interface CoverageCertificate {
  title: string;
  subtitle: string;
  product: CertificateProduct;
  productLabel: string;
  policyId: string;
  policyIdShort: string;
  coverage: string;
  premium: string | null;
  asset: string | null;
  network: string;
  pool: string | null;
  midnightCommitment: string | null;
  start: number | null;
  expiry: number;
  claimDeadline: number;
  waitingPeriodMs: number | null;
  trigger: string;
  trackerUrl: string;
  termsUrl: string;
  claimUrl: string;
  issuedAt: number;
  rows: CertificateRow[];
  disclaimers: string[];
}

const PRODUCT_LABEL: Record<CertificateProduct, string> = {
  depeg: "USDM depeg cover",
  exploit: "Smart-contract exploit cover",
};

const DEFAULT_TRIGGER: Record<CertificateProduct, string> = {
  depeg: "USDM peg below 95.00% for 24 hours, attested by at least 2 of 3 allowlisted oracle feeds",
  exploit: "Approved Midnight claim plus a 2-of-3 assessor Settle on Cardano",
};

const normId = (id: string) => {
  const h = id.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error("policyId must be 64 hex characters");
  return h;
};

const checkTime = (name: string, ms: number) => {
  if (!Number.isFinite(ms) || ms <= 0) throw new Error(`${name} must be a positive ms timestamp`);
};

/** UTC ISO date without milliseconds: 2026-10-13T21:00:00Z */
export const certTime = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Human term span, e.g. "2026-10-13T21:00:00Z → 2026-11-12T21:00:00Z". */
const termSpan = (start: number | null, expiry: number) =>
  start !== null ? `${certTime(start)} → ${certTime(expiry)}` : `active until ${certTime(expiry)}`;

/**
 * Build a structured Certificate of Cover from a policy record. Throws on a
 * bad policy id or times (same rules as policyCalendarEvents).
 */
export function buildCoverageCertificate(input: CoverageCertificateInput): CoverageCertificate {
  const id = normId(input.policyId);
  checkTime("expiry", input.expiry);
  if (!Number.isFinite(input.claimGraceMs) || input.claimGraceMs < 0) throw new Error("claimGraceMs must be >= 0");
  if (input.start !== null) {
    checkTime("start", input.start);
    if (input.start >= input.expiry) throw new Error("start must be before expiry");
  }
  if (input.waitingPeriodMs != null && (!Number.isFinite(input.waitingPeriodMs) || input.waitingPeriodMs < 0)) {
    throw new Error("waitingPeriodMs must be >= 0");
  }
  const coverage = String(input.coverage ?? "").trim();
  if (!coverage) throw new Error("coverage is required");

  const issuedAt = input.issuedAt ?? input.expiry;
  checkTime("issuedAt", issuedAt);

  const productLabel = PRODUCT_LABEL[input.product];
  const short = `${id.slice(0, 8)}…${id.slice(-4)}`;
  const claimDeadline = input.expiry + input.claimGraceMs;
  const premium = input.premium?.trim() ? input.premium.trim() : null;
  const asset = input.asset?.trim() ? input.asset.trim() : null;
  const pool = input.pool?.trim() ? input.pool.trim() : null;
  const midnightCommitment = input.midnightCommitment?.trim()
    ? input.midnightCommitment.trim().toLowerCase().replace(/^0x/, "")
    : null;
  const trigger = (input.trigger?.trim() || DEFAULT_TRIGGER[input.product]).trim();
  const waitingPeriodMs = input.waitingPeriodMs ?? null;

  const rows: CertificateRow[] = [
    { label: "Product", value: productLabel },
    { label: "Policy id", value: id },
    { label: "Coverage", value: coverage },
  ];
  if (premium) rows.push({ label: "Premium", value: premium });
  if (asset) rows.push({ label: "Asset / ticker", value: asset });
  rows.push(
    { label: "Term", value: termSpan(input.start, input.expiry) },
    { label: "Claim deadline", value: certTime(claimDeadline) },
  );
  if (waitingPeriodMs != null && waitingPeriodMs > 0) {
    const mins = waitingPeriodMs / 60_000;
    const wait =
      waitingPeriodMs % 3_600_000 === 0
        ? `${waitingPeriodMs / 3_600_000} hour${waitingPeriodMs === 3_600_000 ? "" : "s"}`
        : mins % 1 === 0
          ? `${mins} minute${mins === 1 ? "" : "s"}`
          : `${waitingPeriodMs} ms`;
    rows.push({ label: "Waiting period", value: wait });
  }
  rows.push(
    { label: "What pays", value: trigger },
    { label: "Network", value: `${input.network} (testnet; not audited)` },
  );
  if (pool) rows.push({ label: "Pool", value: pool });
  if (midnightCommitment) rows.push({ label: "Midnight commitment", value: midnightCommitment });
  rows.push(
    { label: "Policy tracker", value: input.trackerUrl },
    { label: "Cover wording", value: input.termsUrl },
    { label: "File a claim", value: input.claimUrl },
    { label: "Issued", value: certTime(issuedAt) },
  );

  const disclaimers = [
    "This is a Certificate of Cover for a PlutusShield testnet policy. It is not a regulated insurance policy, a financial product, or a guarantee of payment.",
    "Payout depends on on-chain validators and, as applicable, the oracle quorum (depeg) or the assessor committee and Midnight claim resolution (exploit). Marketing copy does not override the deployment params.",
    `${input.network} only. Contracts are not audited. Test value only.`,
    "Built in the browser from the policy record and deployment params; nothing is uploaded to PlutusShield to produce this file.",
  ];

  return {
    title: "Certificate of Cover",
    subtitle: `PlutusShield · ${productLabel} · ${short}`,
    product: input.product,
    productLabel,
    policyId: id,
    policyIdShort: short,
    coverage,
    premium,
    asset,
    network: input.network,
    pool,
    midnightCommitment,
    start: input.start,
    expiry: input.expiry,
    claimDeadline,
    waitingPeriodMs,
    trigger,
    trackerUrl: input.trackerUrl,
    termsUrl: input.termsUrl,
    claimUrl: input.claimUrl,
    issuedAt,
    rows,
    disclaimers,
  };
}

/** Plain Markdown suitable for download / print (deterministic). */
export function coverageCertificateMarkdown(cert: CoverageCertificate): string {
  const lines = [
    `# ${cert.title}`,
    "",
    cert.subtitle,
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...cert.rows.map((r) => `| ${r.label.replace(/\|/g, "\\|")} | ${r.value.replace(/\|/g, "\\|")} |`),
    "",
    "## Disclaimers",
    "",
    ...cert.disclaimers.map((d) => `- ${d}`),
    "",
    "---",
    "",
    "PlutusShield · Cardano Preview + Midnight Preprod · https://kshot3000.github.io/PlutusShield/",
    "",
  ];
  return lines.join("\n");
}

/** Suggested download name: plutusshield-cover-<first 8 hex>.md */
export const coverageCertificateFilename = (policyId: string) =>
  `plutusshield-cover-${normId(policyId).slice(0, 8)}.md`;

/** Plain text for a print dialog (same facts, no Markdown table). */
export function coverageCertificatePlainText(cert: CoverageCertificate): string {
  const lines = [
    cert.title,
    cert.subtitle,
    "",
    ...cert.rows.map((r) => `${r.label}: ${r.value}`),
    "",
    "Disclaimers",
    ...cert.disclaimers.map((d) => `- ${d}`),
    "",
  ];
  return lines.join("\n");
}
