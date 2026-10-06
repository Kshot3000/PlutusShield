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
};

const ACTION_FIELDS = `__typename ... on ContractCall { entryPoint } transaction { hash block { height timestamp } ... on RegularTransaction { transactionResult { status } } }`;

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
  opts: { net?: MidnightNetwork; timeoutMs?: number } = {},
): () => void {
  const net = opts.net ?? MIDNIGHT_PREPROD_INDEXER;
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
            query: `subscription($a: HexEncoded!, $o: BlockOffset) { contractActions(address: $a, offset: $o) { ${ACTION_FIELDS} } }`,
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
      h.onAction(a);
      if (caughtUp) {
        // A new call landed: refresh the state so mirrored-policy checks stay current.
        latestContractAction(address, net, abort.signal).then((l) => l && !closed && h.onLiveState?.(l.state), () => {});
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
  for (let i = s.indexOf(id); i !== -1; i = s.indexOf(id, i + 1)) if (i % 2 === 0) return true;
  return false;
}
