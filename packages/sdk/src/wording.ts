/**
 * Cover wording: the plain-language terms of a PlutusShield policy, written
 * from the deployment's own script parameters rather than typed by hand.
 *
 * Every number in the wording (trigger threshold, window, quorum, waiting
 * period, sale-guard freshness, term range, caps, minimum premium, claim
 * grace, committee threshold) is read from the `params` record the validator
 * was compiled with, so the wording cannot drift from what the chain
 * enforces. Every clause says who enforces it and names the check in the
 * source, so a reader can verify the promise instead of trusting the copy.
 *
 * Pure and deterministic: no wallet, no network.
 */

export type WordingProduct = "depeg" | "exploit";

/** The `params` block of a Cardano deployment record (string integers, hex names). */
export interface WordingParamsJson {
  assets: { asset: { policyId: string; assetName: string }; minPremium: string }[];
  product: {
    productId: string;
    trigger: { coveredAsset: string; thresholdBps: string; windowMs: string };
    baseRateBps: string;
    riskMultBps: string;
    minDays: string;
    maxDays: string;
    maxSinglePolicyBps: string;
    maxUtilizationBps: string;
  };
  oracle: { feeds: string[]; quorum: string };
  claimGraceMs: string;
  saleGuard: { waitingPeriodMs: string; maxPriceAgeMs: string };
}

export interface WordingInput {
  product: WordingProduct;
  params: WordingParamsJson;
  /** Required for exploit cover: the M-of-N assessor committee fixed in the script parameters. */
  committee?: { threshold: number; seats: number };
  /** e.g. "Cardano Preview" */
  network: string;
  /** Repo path of the deployment record the params came from. */
  source: string;
}

/** Who makes a clause true. "validator" means a transaction breaking it cannot land. */
export type EnforcedBy = "validator" | "oracle quorum" | "assessor committee" | "disclosure";

export interface ScheduleRow {
  term: string;
  value: string;
  enforcedBy: EnforcedBy;
  /** Where the check lives, e.g. "cover.ak validate_buy". */
  check: string;
}

export interface WordingClause {
  id: string;
  heading: string;
  body: string;
  enforcedBy: EnforcedBy;
  check: string;
}

export interface CoverWording {
  product: WordingProduct;
  title: string;
  network: string;
  source: string;
  /** Short human name of the covered asset or risk, decoded from the on-chain trigger. */
  covered: string;
  schedule: ScheduleRow[];
  clauses: WordingClause[];
  notCovered: string[];
}

const HOUR = 3_600_000;
const MIN = 60_000;
const DAY = 86_400_000;

const int = (name: string, s: string): bigint => {
  if (!/^-?\d+$/.test(String(s).trim())) throw new Error(`${name} must be an integer string`);
  return BigInt(String(s).trim());
};
const num = (name: string, s: string) => Number(int(name, s));

/** Decode a UTF-8 hex name; throws on bad hex so a corrupt record can't render as garbage. */
export const hexToText = (hex: string): string => {
  if (!/^([0-9a-fA-F]{2})*$/.test(hex)) throw new Error(`not hex: ${hex}`);
  const bytes = Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
};

/** "1 hour", "10 minutes", "72 hours (3 days)", "24 hours". */
export const fmtDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) throw new Error("duration must be >= 0");
  const plural = (n: number, u: string) => `${n} ${u}${n === 1 ? "" : "s"}`;
  if (ms === 0) return "none";
  if (ms % HOUR === 0) {
    const h = ms / HOUR;
    return h > 24 && h % 24 === 0 ? `${plural(h, "hour")} (${plural(h / 24, "day")})` : plural(h, "hour");
  }
  if (ms % MIN === 0) return plural(ms / MIN, "minute");
  return plural(Math.round(ms / 1000), "second");
};

/** 9500 -> "95.00%" */
export const fmtBps = (bps: number): string => `${(bps / 100).toFixed(2)}%`;

const KNOWN_TOKENS: Record<string, number> = { USDCx: 6, tUSDCx: 6 };

/** Ticker and decimals of a tranche asset. Unknown tokens throw rather than guess decimals. */
export const trancheAsset = (a: { policyId: string; assetName: string }): { ticker: string; decimals: number } => {
  if (a.policyId === "" && a.assetName === "") return { ticker: "ADA", decimals: 6 };
  const ticker = hexToText(a.assetName);
  const decimals = KNOWN_TOKENS[ticker];
  if (decimals === undefined) throw new Error(`unknown tranche token ${ticker}: decimals not known`);
  return { ticker, decimals };
};

const fmtUnits = (base: bigint, decimals: number) => {
  const unit = 10n ** BigInt(decimals);
  const whole = base / unit;
  const frac = (base % unit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
};

const TITLE: Record<WordingProduct, string> = {
  depeg: "Stablecoin depeg cover",
  exploit: "Smart-contract exploit cover",
};

/** Build the wording for one product from its deployment params. */
export function coverWording(input: WordingInput): CoverWording {
  const { product, params: p } = input;
  const pid = hexToText(p.product.productId);
  if (pid !== product) throw new Error(`params are for product "${pid}", not "${product}"`);
  const covered = hexToText(p.product.trigger.coveredAsset);
  const thresholdBps = num("thresholdBps", p.product.trigger.thresholdBps);
  const windowMs = num("windowMs", p.product.trigger.windowMs);
  const minDays = num("minDays", p.product.minDays);
  const maxDays = num("maxDays", p.product.maxDays);
  const singleBps = num("maxSinglePolicyBps", p.product.maxSinglePolicyBps);
  const utilBps = num("maxUtilizationBps", p.product.maxUtilizationBps);
  const baseBps = num("baseRateBps", p.product.baseRateBps);
  const riskBps = num("riskMultBps", p.product.riskMultBps);
  const graceMs = num("claimGraceMs", p.claimGraceMs);
  const waitMs = num("waitingPeriodMs", p.saleGuard.waitingPeriodMs);
  const ageMs = num("maxPriceAgeMs", p.saleGuard.maxPriceAgeMs);
  const quorum = num("quorum", p.oracle.quorum);
  const feeds = p.oracle.feeds.length;
  if (minDays < 1 || maxDays < minDays) throw new Error("term range is invalid");
  if (p.assets.length === 0) throw new Error("no tranche assets");
  const tranches = p.assets.map((a) => {
    const t = trancheAsset(a.asset);
    return { ...t, minPremium: fmtUnits(int("minPremium", a.minPremium), t.decimals) };
  });
  const tickers = tranches.map((t) => t.ticker);
  const tickerList = tickers.length === 1 ? tickers[0] : `${tickers.slice(0, -1).join(", ")} or ${tickers.at(-1)}`;
  const file = product === "depeg" ? "cover.ak" : "exploit_cover.ak";

  let committee: { threshold: number; seats: number } | null = null;
  if (product === "depeg") {
    if (feeds < 1 || quorum < 1 || quorum > feeds) throw new Error("depeg cover needs an oracle quorum of 1..feeds");
    if (thresholdBps <= 0 || thresholdBps > 10_000) throw new Error("depeg threshold must be in (0, 10000] bps");
  } else {
    committee = input.committee ?? null;
    if (!committee) throw new Error("exploit cover wording needs the assessor committee");
    if (committee.threshold < 1 || committee.threshold > committee.seats) throw new Error("committee threshold must be 1..seats");
  }

  const schedule: ScheduleRow[] = [];
  const row = (term: string, value: string, enforcedBy: EnforcedBy, check: string) => schedule.push({ term, value, enforcedBy, check });

  if (product === "depeg") {
    row("Covered asset", covered, "validator", `${file} validate_buy (trigger fixed by the product)`);
    row("Trigger", `${covered} below ${fmtBps(thresholdBps)} of peg for at least ${fmtDuration(windowMs)}`, "oracle quorum", "oracle.ak attests");
    row("Oracle quorum", `${quorum} of ${feeds} allowlisted feeds`, "validator", "oracle.ak triggered");
    row("Sale guard", `all ${feeds} feeds healthy, readings at most ${fmtDuration(ageMs)} old`, "validator", "oracle.ak healthy");
  } else {
    row("Covered risk", "Exploit of a covered Cardano DeFi contract", "assessor committee", `${file} Settle`);
    row("Decided by", `${committee!.threshold} of ${committee!.seats} assessor signatures on the payout`, "validator", `${file} committee_approves`);
  }
  row("Waiting period", fmtDuration(waitMs), "validator", `${file} validate_buy`);
  row("Term", `${minDays}–${maxDays} whole days`, "validator", `${file} validate_buy`);
  row("Premium and payout currency", tickerList, "validator", `${file} tranche_of`);
  row("Base rate", `${fmtBps(baseBps)} a year × risk multiplier ${(riskBps / 10_000).toFixed(2)} × utilization multiplier`, "validator", "pricing.ak required_premium");
  row("Minimum premium", tranches.map((t) => `${t.minPremium} ${t.ticker}`).join(", "), "validator", "pricing.ak required_premium");
  row("Largest single policy", `${fmtBps(singleBps)} of its tranche's capital`, "validator", "pricing.ak within_capacity");
  row("Tranche utilization cap", `${fmtBps(utilBps)} of capital`, "validator", "pricing.ak within_capacity");
  row("Claim window", product === "depeg" ? `until ${fmtDuration(graceMs)} after expiry` : `cover start to ${fmtDuration(graceMs)} after expiry`, "validator", `${file} Settle`);
  row("Payout", "the full coverage amount, once, in the policy's currency", "validator", `${file} Settle`);

  const clauses: WordingClause[] = [];
  const clause = (id: string, heading: string, body: string, enforcedBy: EnforcedBy, check: string) =>
    clauses.push({ id, heading, body, enforcedBy, check });

  if (product === "depeg") {
    clause(
      "covered-event",
      "What triggers a payout",
      `${covered} trading below ${fmtBps(thresholdBps)} of its peg, measured over a window of at least ${fmtDuration(windowMs)}, attested by at least ${quorum} of the ${feeds} allowlisted oracle feeds. Nobody votes and there is no claim form: the attestations are the claim.`,
      "oracle quorum",
      "oracle.ak triggered / attests",
    );
    clause(
      "inside-the-term",
      "The depeg has to happen inside your cover",
      `An attested window counts only if it starts on or after your cover start and ends on or before your expiry. A window that began before cover started, or runs past expiry, does not pay.`,
      "validator",
      "oracle.ak attests",
    );
    clause(
      "sale-guard",
      "You cannot buy into a depeg",
      `A purchase lands only if every one of the ${feeds} allowlisted feeds reports ${covered} at or above ${fmtBps(thresholdBps)}, with readings at most ${fmtDuration(ageMs)} old. One stale, missing or depegged feed closes sales. This guard never affects settling a policy you already hold.`,
      "validator",
      "oracle.ak healthy",
    );
  } else {
    clause(
      "covered-event",
      "What triggers a payout",
      `Funds lost to an exploit of a covered Cardano DeFi contract, as decided by the assessor committee. You file a sealed evidence commitment on Midnight; the payout transaction on Cardano needs signatures from ${committee!.threshold} of the ${committee!.seats} distinct committee keys fixed at deployment, and fewer is rejected by the validator.`,
      "assessor committee",
      `${file} committee_approves`,
    );
    clause(
      "inside-the-term",
      "The exploit has to happen inside your cover",
      `The validator checks when the payout lands (not before cover start, not after the claim window). Whether the loss itself happened during your cover is for the committee to decide from your evidence.`,
      "assessor committee",
      `${file} Settle`,
    );
    clause(
      "trust",
      "What you are trusting",
      `Cardano cannot read Midnight, so the committee's signatures are the bridge: each assessor signs only after checking that the Midnight claim resolved as approved, and the payout carries that resolution in its metadata. Today the ${committee!.seats} keys are run by the PlutusShield team, not independent operators.`,
      "disclosure",
      "preview-exploit-v2.json trust",
    );
  }
  clause(
    "waiting-period",
    "When cover starts",
    `Cover starts no earlier than ${fmtDuration(waitMs)} after the latest moment your purchase can land on-chain, so a policy can never be backdated${product === "exploit" ? " or bought against an exploit already under way" : ""}.`,
    "validator",
    `${file} validate_buy`,
  );
  clause(
    "term",
    "How long cover lasts",
    `A term is a whole number of days from ${minDays} to ${maxDays}. The product's trigger and terms are fixed by the pool, not chosen by the buyer.`,
    "validator",
    `${file} validate_buy`,
  );
  clause(
    "premium",
    "What you pay",
    `You pay the premium once, at purchase, in ${tickerList}. It is at least the larger of the minimum premium and coverage × ${fmtBps(baseBps)} a year × risk multiplier ${(riskBps / 10_000).toFixed(2)} × the average utilization multiplier before and after your policy × days / 365. The premium goes to the tranche that backs your policy and is not refunded at expiry.`,
    "validator",
    "pricing.ak required_premium",
  );
  clause(
    "capacity",
    "Every policy is fully backed",
    `A single policy can be at most ${fmtBps(singleBps)} of its tranche's capital, and a tranche's active cover can never exceed ${fmtBps(utilBps)} of its capital. An ADA policy is backed by ADA capital only, a USDC policy by USDC capital only, and LP withdrawals cannot take a tranche below what its live cover needs at that cap.`,
    "validator",
    "pricing.ak within_capacity",
  );
  clause(
    "payout",
    "How you are paid",
    `A payout releases exactly your coverage amount, once, in your policy's currency, from your policy's tranche. It burns both the policy reference token and your user token, so whoever holds the user token holds the claim right: keep it in your own wallet.`,
    "validator",
    `${file} Settle`,
  );
  clause(
    "claim-window",
    "Deadline to claim",
    `A payout must land no later than ${fmtDuration(graceMs)} after your expiry. After that, anyone may expire the policy: the reserved cover goes back to the pool and the policy's min-ada deposit returns to the refund address you chose at purchase.`,
    "validator",
    `${file} Settle / Expire`,
  );
  clause(
    "privacy",
    "What is public",
    `Your Cardano policy carries only a 32-byte commitment to your private Midnight key${product === "exploit" ? "; your claim evidence stays sealed on Midnight" : ""}. Coverage and premium amounts on Cardano are public.`,
    "validator",
    `${file} validate_buy`,
  );
  clause(
    "no-admin",
    "Nobody can change your terms",
    `There is no admin key. Every term above is fixed in the script parameters at deployment, so it cannot change while your policy is live.`,
    "validator",
    `${file} (parameterised validator)`,
  );
  clause(
    "testnet",
    "Testnet only",
    `This product runs on ${input.network} with test value only. The contracts are not audited, and this is not a regulated insurance contract.`,
    "disclosure",
    "SECURITY.md",
  );

  const notCovered =
    product === "depeg"
      ? [
          `A dip below ${fmtBps(thresholdBps)} that lasts less than ${fmtDuration(windowMs)}.`,
          `A depeg attested by fewer than ${quorum} of the ${feeds} feeds.`,
          "A depeg window that starts before your cover starts or ends after it expires.",
          `Any asset other than ${covered}.`,
          "More than your coverage amount: the payout is fixed, not measured against your actual loss.",
          `A payout submitted more than ${fmtDuration(graceMs)} after expiry.`,
        ]
      : [
          `A claim that fewer than ${committee!.threshold} of the ${committee!.seats} assessors approve.`,
          "A loss the committee finds happened outside your cover period.",
          "More than your coverage amount: the payout is fixed, not measured against your actual loss.",
          "A payout submitted before your cover starts.",
          `A payout submitted more than ${fmtDuration(graceMs)} after expiry.`,
        ];

  return { product, title: TITLE[product], network: input.network, source: input.source, covered, schedule, clauses, notCovered };
}

/** The wording as a standalone Markdown document (deterministic). */
export function coverWordingMarkdown(w: CoverWording): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const lines = [
    `# PlutusShield ${w.title}: cover wording`,
    "",
    `Network: ${w.network}. Terms read from \`${w.source}\`. Test value only, not audited, not a regulated insurance contract.`,
    "",
    "## Schedule",
    "",
    "| Term | Value | Enforced by | Check |",
    "| --- | --- | --- | --- |",
    ...w.schedule.map((r) => `| ${esc(r.term)} | ${esc(r.value)} | ${r.enforcedBy} | \`${esc(r.check)}\` |`),
    "",
    "## Clauses",
    "",
  ];
  w.clauses.forEach((c, i) => {
    lines.push(`### ${i + 1}. ${c.heading}`, "", c.body, "", `Enforced by: ${c.enforcedBy} (\`${c.check}\`)`, "");
  });
  lines.push("## Not covered", "", ...w.notCovered.map((n) => `- ${n}`), "");
  return lines.join("\n");
}

export const coverWordingFilename = (w: CoverWording) => `plutusshield-${w.product}-cover-wording.md`;
