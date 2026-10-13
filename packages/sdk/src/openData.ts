/**
 * Open data feeds: the public, read-only JSON datasets the site publishes at
 * /api/v1/*.json on every build, from the same deployment records and
 * snapshots its pages render (products, claims register, underwriting book,
 * oracle publishes). Dashboards, aggregators and partner protocols can read
 * them without a wallet, an API key or our UI.
 *
 * Every file is wrapped in one envelope so a consumer can check the schema
 * version, the networks and the testnet / not-audited flags before trusting
 * the data. Amounts are base-unit strings (lovelace, USDC micro-units) so
 * nothing loses precision in JSON.
 */

export const OPEN_DATA_SCHEMA = "plutusshield.open-data/v1" as const;
export const OPEN_DATA_VERSION = "v1" as const;

export type OpenDataset = "index" | "products" | "claims" | "book" | "oracle";

export interface OpenDataEndpoint {
  dataset: OpenDataset;
  /** Path under the site root, e.g. "api/v1/products.json". */
  path: string;
  title: string;
  description: string;
  /** Where the same data renders on the site. */
  page: string | null;
}

export const OPEN_DATA_ENDPOINTS: readonly OpenDataEndpoint[] = [
  {
    dataset: "index",
    path: "api/v1/index.json",
    title: "Index",
    description: "This list of datasets, with the schema version, networks and when the site was built.",
    page: "docs/api",
  },
  {
    dataset: "products",
    path: "api/v1/products.json",
    title: "Cover products",
    description:
      "Every cover product: status (live or priced), premium currencies, trigger, claim model, base rate, and for live products the deployed pool parameters and capital.",
    page: "products",
  },
  {
    dataset: "claims",
    path: "api/v1/claims.json",
    title: "Claims register",
    description:
      "Every decided claim across Cardano Preview and Midnight Preprod with each transaction, committee votes, Settle signers, refused Settle attempts, and the lowest live oracle reading against the depeg trigger.",
    page: "claims",
  },
  {
    dataset: "book",
    path: "api/v1/book.json",
    title: "Underwriting book",
    description:
      "Every Preview pool with its open risk-tier scorecard answers, risk multiplier, tranches (capital, active cover, free capacity, utilization) and key transactions.",
    page: "book",
  },
  {
    dataset: "oracle",
    path: "api/v1/oracle.json",
    title: "Oracle publishes",
    description:
      "The USDM peg readings published to the Preview oracle feeds, newest first, with each transaction and the depeg trigger they are judged against.",
    page: "oracle",
  },
];

export interface OpenDataEnvelope<T = unknown> {
  schema: typeof OPEN_DATA_SCHEMA;
  dataset: OpenDataset;
  /** ISO time the static site (and so this file) was built. */
  generatedAt: string;
  networks: { cardano: "preview"; midnight: "preprod" };
  testnetOnly: true;
  audited: false;
  /** Public source repository the data is built from. */
  source: string;
  /** Where the same data renders as a page. */
  page: string | null;
  data: T;
}

export const OPEN_DATA_SOURCE = "https://github.com/Kshot3000/PlutusShield";

const endpointOf = (dataset: OpenDataset) => {
  const e = OPEN_DATA_ENDPOINTS.find((x) => x.dataset === dataset);
  if (!e) throw new Error(`open data: unknown dataset ${dataset}`);
  return e;
};

/** Absolute URL of a dataset under a site root (with or without a trailing slash). */
export const openDataUrl = (siteRoot: string, dataset: OpenDataset): string =>
  `${siteRoot.replace(/\/+$/, "")}/${endpointOf(dataset).path}`;

/** Wrap a dataset in the v1 envelope. `siteRoot` turns the page path into an absolute URL. */
export function openDataEnvelope<T>(dataset: OpenDataset, data: T, opts: { generatedAt: string; siteRoot: string }): OpenDataEnvelope<T> {
  const e = endpointOf(dataset);
  if (Number.isNaN(Date.parse(opts.generatedAt))) throw new Error("open data: generatedAt must be an ISO time");
  return {
    schema: OPEN_DATA_SCHEMA,
    dataset,
    generatedAt: opts.generatedAt,
    networks: { cardano: "preview", midnight: "preprod" },
    testnetOnly: true,
    audited: false,
    source: OPEN_DATA_SOURCE,
    page: e.page === null ? null : `${opts.siteRoot.replace(/\/+$/, "")}/${e.page}/`,
    data,
  };
}

/** JSON.stringify that writes bigint as a decimal string (amounts stay exact). */
export const openDataJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

export type OpenDataCheck = { ok: true } | { ok: false; reason: string };

/** Check a fetched value is a v1 envelope for the expected dataset before reading `data`. */
export function checkOpenDataEnvelope(v: unknown, expected?: OpenDataset): OpenDataCheck {
  if (!v || typeof v !== "object") return { ok: false, reason: "not an object" };
  const o = v as Record<string, unknown>;
  if (o.schema !== OPEN_DATA_SCHEMA) return { ok: false, reason: `unsupported schema ${String(o.schema)}` };
  if (!OPEN_DATA_ENDPOINTS.some((e) => e.dataset === o.dataset)) return { ok: false, reason: `unknown dataset ${String(o.dataset)}` };
  if (expected && o.dataset !== expected) return { ok: false, reason: `expected ${expected}, got ${String(o.dataset)}` };
  if (typeof o.generatedAt !== "string" || Number.isNaN(Date.parse(o.generatedAt))) return { ok: false, reason: "generatedAt is not an ISO time" };
  const n = o.networks as Record<string, unknown> | undefined;
  if (!n || n.cardano !== "preview" || n.midnight !== "preprod") return { ok: false, reason: "networks are not Cardano Preview + Midnight Preprod" };
  if (o.testnetOnly !== true || o.audited !== false) return { ok: false, reason: "missing testnet / not-audited flags" };
  if (!("data" in o)) return { ok: false, reason: "no data" };
  return { ok: true };
}

/** Fetch one dataset and check its envelope. Throws with the reason on a mismatch. */
export async function fetchOpenData<T = unknown>(
  siteRoot: string,
  dataset: OpenDataset,
  fetchImpl: typeof fetch = fetch,
): Promise<OpenDataEnvelope<T>> {
  const url = openDataUrl(siteRoot, dataset);
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`open data: ${url} returned ${res.status}`);
  const body = (await res.json()) as unknown;
  const c = checkOpenDataEnvelope(body, dataset);
  if (!c.ok) throw new Error(`open data: ${url}: ${c.reason}`);
  return body as OpenDataEnvelope<T>;
}
