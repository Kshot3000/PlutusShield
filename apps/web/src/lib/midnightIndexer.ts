/**
 * Read-only client for the public Midnight Preprod indexer (GraphQL v4), used to
 * show the policy-cover contract's on-chain activity live in the browser.
 *
 * No WASM, no wallet, no keys: it streams `contractActions` for one address over
 * the indexer's graphql-transport-ws socket (history from the deploy block, then
 * new calls as they land) and fetches the latest serialized contract state over
 * HTTP. Imports nothing, so `scripts/snapshot-midnight.mjs` can load it with
 * Node's type stripping at build time.
 */

export type MidnightNetwork = { http: string; ws: string };

export const MIDNIGHT_PREPROD_INDEXER: MidnightNetwork = {
  http: "https://indexer.preprod.midnight.network/api/v4/graphql",
  ws: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
};

export type MidnightAction = {
  /** "deploy" for the ContractDeploy, otherwise the circuit name (registerPolicy, proveCover, …). */
  entryPoint: string;
  txHash: string;
  height: number;
  /** Block timestamp, ms since epoch. */
  timestamp: number;
  /** SUCCESS, PARTIAL_SUCCESS or FAILURE as reported by the indexer. */
  status: string;
  /**
   * Policy records this action changed, from diffing the contract state before
   * and after it (fileClaim: ACTIVE -> CLAIM_PENDING, resolveClaim: -> PAID or
   * back to ACTIVE, …). Empty for calls that only bump a counter (proveCover).
   */
  changes?: PolicyChange[];
};

export type PolicyChange = {
  policyId: string;
  from: MidnightPolicyStatus | "NONE";
  to: MidnightPolicyStatus;
  /** Evidence commitment on the record after the action (null when cleared / none). */
  evidence: string | null;
};

const ACTION_FIELDS = `__typename ... on ContractCall { entryPoint } transaction { hash block { height timestamp } ... on RegularTransaction { transactionResult { status } } }`;
/** Same, plus the serialized contract state after the action (for per-policy diffs). */
const ACTION_FIELDS_STATE = `state ${ACTION_FIELDS}`;

type RawAction = {
  __typename: string;
  entryPoint?: string;
  state?: string;
  transaction: { hash: string; block: { height: number; timestamp: number }; transactionResult?: { status: string } };
};

const toAction = (c: RawAction): MidnightAction => ({
  entryPoint: c.__typename === "ContractDeploy" ? "deploy" : (c.entryPoint ?? c.__typename),
  txHash: c.transaction.hash,
  height: c.transaction.block.height,
  timestamp: c.transaction.block.timestamp,
  status: c.transaction.transactionResult?.status ?? "SUCCESS",
});

/** The contract's most recent action and its full serialized state (hex). */
export async function latestContractAction(
  address: string,
  net: MidnightNetwork = MIDNIGHT_PREPROD_INDEXER,
  signal?: AbortSignal,
): Promise<{ action: MidnightAction; state: string } | null> {
  const res = await fetch(net.http, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/graphql-response+json, application/json" },
    body: JSON.stringify({
      query: `query($a: HexEncoded!) { contractAction(address: $a) { state ${ACTION_FIELDS} } }`,
      variables: { a: address },
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Midnight indexer ${res.status}`);
  const body = (await res.json()) as { data?: { contractAction: RawAction | null }; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`Midnight indexer: ${body.errors[0].message}`);
  const c = body.data?.contractAction;
  return c ? { action: toAction(c), state: c.state ?? "" } : null;
}

// ---------------------------------------------------------------------------
// Policy records from the serialized state (no WASM)
// ---------------------------------------------------------------------------

/** PolicyStatus in policy-cover.compact (NONE is never stored). */
export const MIDNIGHT_POLICY_STATUSES = ["ACTIVE", "CLAIM_PENDING", "PAID", "EXPIRED"] as const;
export type MidnightPolicyStatus = (typeof MIDNIGHT_POLICY_STATUSES)[number];

export type MidnightPolicyRecord = {
  policyId: string;
  /** Holder commitment (64 hex). */
  holder: string;
  /** Coverage commitment (64 hex). */
  coverage: string;
  /** Expiry, POSIX ms (a JS number: exact below 2^53, i.e. any real timestamp). */
  expiry: number;
  status: MidnightPolicyStatus;
  /** Evidence commitment of a pending / paid claim, null when none. */
  evidence: string | null;
};

const ZERO32 = "0".repeat(64);

/**
 * One value cell of the state encoding (as the indexer serializes a
 * ContractState). Values are little-endian byte strings with trailing zero
 * bytes stripped: a byte < 0x40 is a one-byte value by itself, 0x40+n
 * (n < 32) prefixes n bytes, and 0x60 0x01 prefixes 32 bytes.
 * Returns the value's bytes (hex, unpadded) and the next offset, or null.
 */
function readCell(s: string, i: number): { v: string; next: number } | null {
  if (i + 2 > s.length) return null;
  const b = parseInt(s.slice(i, i + 2), 16);
  if (Number.isNaN(b)) return null;
  if (b < 0x40) return { v: s.slice(i, i + 2), next: i + 2 };
  if (b < 0x60) {
    const n = b - 0x40;
    const end = i + 2 + n * 2;
    return end > s.length ? null : { v: s.slice(i + 2, end), next: end };
  }
  if (s.slice(i, i + 4) === "6001") {
    const end = i + 4 + 64;
    return end > s.length ? null : { v: s.slice(i + 4, end), next: end };
  }
  return null;
}

/** Encode a 32-byte value the way readCell reads it (trailing zeros stripped). */
function cellHex(hex32: string): string {
  const v = hex32.replace(/(00)+$/, "");
  const n = v.length / 2;
  if (n === 32) return `6001${v}`;
  if (n === 1 && parseInt(v, 16) < 0x40) return v;
  return (0x40 + n).toString(16) + v;
}

const pad32 = (v: string) => v + "0".repeat(64 - v.length);
const leToNumber = (v: string) => {
  let n = 0n;
  for (let i = v.length - 2; i >= 0; i -= 2) n = (n << 8n) | BigInt(parseInt(v.slice(i, i + 2), 16));
  return Number(n);
};

/** The 5-field PolicyRecord that follows a map key, or null if the bytes there aren't one. */
function readRecordAt(s: string, i: number, policyId: string): MidnightPolicyRecord | null {
  // Record header: 2001 xxxx 0185 (a 5-field struct value).
  if (s.slice(i, i + 4) !== "2001" || s.slice(i + 8, i + 12) !== "0185") return null;
  let p = i + 12;
  const cells: string[] = [];
  for (let k = 0; k < 5; k++) {
    const c = readCell(s, p);
    if (!c) return null;
    cells.push(c.v);
    p = c.next;
  }
  const [holder, coverage, expiry, status, evidence] = cells;
  if (holder.length > 64 || coverage.length > 64 || evidence.length > 64 || expiry.length > 16 || status.length !== 2) return null;
  const st = parseInt(status, 16);
  if (st < 1 || st > 4) return null;
  const ev = pad32(evidence);
  return {
    policyId,
    holder: pad32(holder),
    coverage: pad32(coverage),
    expiry: leToNumber(expiry),
    status: MIDNIGHT_POLICY_STATUSES[st - 1],
    evidence: ev === ZERO32 ? null : ev,
  };
}

/**
 * Decode one policy's record from the serialized contract state (hex), or null
 * if the policy isn't in the `policies` map. Pure string parsing, no WASM;
 * contracts/midnight/test/state-decode.test.mjs checks it against the compiled
 * contract's ledger() for every status, trailing-zero ids and live Preprod state.
 */
export function policyRecordFromState(stateHex: string, policyId: string): MidnightPolicyRecord | null {
  const s = stateHex.toLowerCase();
  const id = policyId.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id) || id === ZERO32) return null;
  const key = cellHex(id);
  for (let i = s.indexOf(key + "2001"); i !== -1; i = s.indexOf(key + "2001", i + 1)) {
    if (i % 2) continue;
    const r = readRecordAt(s, i + key.length, id);
    if (r) return r;
  }
  return null;
}

/**
 * Every policy record in the state whose 32-byte id has no trailing zero byte
 * (ids are hashes, so that's ~255/256 of them; pass `extraIds` for the rest).
 */
export function policyRecordsFromState(stateHex: string, extraIds: string[] = []): MidnightPolicyRecord[] {
  const s = stateHex.toLowerCase();
  const out = new Map<string, MidnightPolicyRecord>();
  const re = /6001([0-9a-f]{64})2001[0-9a-f]{4}0185/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index % 2) {
      re.lastIndex = m.index + 1;
      continue;
    }
    const r = readRecordAt(s, m.index + 4 + 64, m[1]);
    if (r && !out.has(r.policyId)) out.set(r.policyId, r);
    re.lastIndex = m.index + 2;
  }
  for (const id of extraIds) {
    const k = id.toLowerCase();
    if (out.has(k)) continue;
    const r = policyRecordFromState(s, k);
    if (r) out.set(k, r);
  }
  return [...out.values()];
}

/** Records whose status or evidence differ between two states (registrations included). */
export function diffPolicies(before: string | null, after: string, extraIds: string[] = []): PolicyChange[] {
  const prev = new Map((before ? policyRecordsFromState(before, extraIds) : []).map((r) => [r.policyId, r]));
  const out: PolicyChange[] = [];
  for (const r of policyRecordsFromState(after, extraIds)) {
    const p = prev.get(r.policyId);
    if (p && p.status === r.status && p.evidence === r.evidence && p.holder === r.holder) continue;
    out.push({ policyId: r.policyId, from: p?.status ?? "NONE", to: r.status, evidence: r.evidence });
  }
  return out;
}

/** What a change means, in words, for the activity feed. */
export function describeChange(c: PolicyChange): string {
  if (c.from === "NONE") return "registered, ACTIVE";
  if (c.from === "ACTIVE" && c.to === "CLAIM_PENDING") return "claim filed (evidence committed)";
  if (c.from === "CLAIM_PENDING" && c.to === "PAID") return "claim approved by assessor";
  if (c.from === "CLAIM_PENDING" && c.to === "ACTIVE") return "claim rejected, back to ACTIVE";
  if (c.to === "EXPIRED") return "expired";
  if (c.from === c.to) return "holder rotated";
  return `${c.from} -> ${c.to}`;
}

export type WatchHandlers = {
  /** Every action, oldest first: history from `fromHeight`, then live calls. */
  onAction: (a: MidnightAction) => void;
  /** History has been replayed up to the action that was latest when the watch started. */
  onCaughtUp?: (latest: { action: MidnightAction; state: string }) => void;
  /** A live action arrived after catch-up; `state` is the contract state after it. */
  onLiveState?: (state: string) => void;
  onError?: (e: Error) => void;
};

/**
 * Stream a contract's actions. Returns a function that closes the socket.
 * Fails (onError) on socket errors or if history doesn't replay within `timeoutMs`.
 */
export function watchContractActions(
  address: string,
  fromHeight: number,
  h: WatchHandlers,
  opts: { net?: MidnightNetwork; timeoutMs?: number; knownPolicyIds?: string[] } = {},
): () => void {
  const net = opts.net ?? MIDNIGHT_PREPROD_INDEXER;
  let prevState: string | null = null;
  const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  let closed = false;
  let ws: WebSocket | null = null;
  const abort = new AbortController();
  const seen = new Set<string>();
  let latest: { action: MidnightAction; state: string } | null = null;
  let caughtUp = false;
  const fail = (e: unknown) => {
    if (closed) return;
    stop();
    h.onError?.(e instanceof Error ? e : new Error(String(e)));
  };
  const stop = () => {
    closed = true;
    clearTimeout(timer);
    abort.abort();
    try {
      ws?.close();
    } catch {
      /* already closed */
    }
  };
  const timer = setTimeout(() => !caughtUp && fail(new Error("Midnight indexer history timed out")), opts.timeoutMs ?? 15_000);
  if (!WS) {
    queueMicrotask(() => fail(new Error("WebSocket is not available")));
    return stop;
  }

  const catchUp = () => {
    if (caughtUp || !latest || !seen.has(latest.action.txHash)) return;
    caughtUp = true;
    clearTimeout(timer);
    h.onCaughtUp?.(latest);
  };

  latestContractAction(address, net, abort.signal).then((l) => {
    if (closed) return;
    if (!l) return fail(new Error("contract not found on the Midnight indexer"));
    latest = l;
    catchUp();
  }, fail);

  ws = new WS(net.ws, "graphql-transport-ws");
  ws.onopen = () => ws?.send(JSON.stringify({ type: "connection_init" }));
  ws.onerror = () => fail(new Error("Midnight indexer socket error"));
  ws.onclose = () => !closed && fail(new Error("Midnight indexer socket closed"));
  ws.onmessage = (m: MessageEvent) => {
    let d: { type: string; id?: string; payload?: unknown };
    try {
      d = JSON.parse(String(m.data));
    } catch {
      return;
    }
    if (d.type === "connection_ack") {
      ws?.send(
        JSON.stringify({
          id: "actions",
          type: "subscribe",
          payload: {
            query: `subscription($a: HexEncoded!, $o: BlockOffset) { contractActions(address: $a, offset: $o) { ${ACTION_FIELDS_STATE} } }`,
            variables: { a: address, o: { height: fromHeight } },
          },
        }),
      );
    } else if (d.type === "ping") {
      ws?.send(JSON.stringify({ type: "pong" }));
    } else if (d.type === "next") {
      const c = (d.payload as { data?: { contractActions?: RawAction } })?.data?.contractActions;
      if (!c) return;
      const a = toAction(c);
      if (seen.has(a.txHash + a.entryPoint)) return;
      seen.add(a.txHash + a.entryPoint);
      seen.add(a.txHash);
      if (c.state) {
        try {
          a.changes = a.entryPoint === "deploy" ? [] : diffPolicies(prevState, c.state, opts.knownPolicyIds);
        } catch {
          /* undecodable state: leave changes unset */
        }
        prevState = c.state;
      }
      h.onAction(a);
      if (caughtUp) {
        // A new call landed: its state is the contract state now, so mirrored / status checks stay current.
        if (c.state) h.onLiveState?.(c.state);
        else latestContractAction(address, net, abort.signal).then((l) => l && !closed && h.onLiveState?.(l.state), () => {});
      } else catchUp();
    } else if (d.type === "error") {
      fail(new Error(`Midnight indexer: ${JSON.stringify(d.payload).slice(0, 200)}`));
    } else if (d.type === "complete") {
      fail(new Error("Midnight indexer subscription ended"));
    }
  };
  return stop;
}

/** Successful calls per circuit. */
export function countCalls(actions: MidnightAction[]): Record<string, number> {
  const n: Record<string, number> = {};
  for (const a of actions) if (a.status === "SUCCESS") n[a.entryPoint] = (n[a.entryPoint] ?? 0) + 1;
  return n;
}

/**
 * Whether a policy id is in the contract's public state. Policy ids are the
 * 32-byte keys of the `policies` map and are serialized verbatim in the state,
 * so a byte-aligned match of the 64 hex chars means the policy is mirrored.
 * (A random 32-byte collision with other state bytes is not a practical concern.)
 */
export function stateHasPolicy(stateHex: string, policyId: string): boolean {
  const s = stateHex.toLowerCase();
  const id = policyId.toLowerCase();
  // Zero bytes pad the serialized state, so an all-zero id would always "match".
  if (!/^[0-9a-f]{64}$/.test(id) || /^0+$/.test(id)) return false;
  if (policyRecordFromState(s, id)) return true;
  for (let i = s.indexOf(id); i !== -1; i = s.indexOf(id, i + 1)) if (i % 2 === 0) return true;
  return false;
}
