/**
 * Watched submit for Midnight Preprod drills.
 *
 * WalletFacade.submitTransaction waits silently for 'Finalized': Ready, Future and
 * Broadcast statuses are swallowed, so a tx that is accepted into the pool but never
 * included looks exactly like a hung client. This sends the same extrinsic the wallet
 * sends (midnight.sendMnTransaction) over the node WebSocket and logs every status
 * with its time, so a stalled submit says where it stalled.
 *
 * Public chain data only: the balanced tx bytes. No keys or seeds pass through here.
 *
 *   const r = await watchedSubmit({ nodeWsUrl, txHex, timeoutMs, log });
 *   // r = { outcome: 'InBlock'|'Finalized'|'Invalid'|'Dropped'|'Usurped'|'Rejected'|'Timeout',
 *   //       statuses: [{ at, status, block? }], extrinsicHash, blockHash?, error? }
 */
import { ApiPromise, WsProvider } from '@polkadot/api';

const TERMINAL_OK = new Set(['InBlock', 'Finalized']);
const TERMINAL_FAIL = new Set(['Invalid', 'Dropped', 'Usurped', 'FinalityTimeout']);

export async function watchedSubmit({ nodeWsUrl, txHex, timeoutMs = 600_000, waitFor = 'InBlock', log = () => {} }) {
  const t0 = Date.now();
  const statuses = [];
  const since = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
  const api = await ApiPromise.create({ provider: new WsProvider(nodeWsUrl), noInitWarn: true, throwOnConnect: true });
  let unsub = null;
  try {
    const ext = api.tx.midnight.sendMnTransaction(txHex.startsWith('0x') ? txHex : `0x${txHex}`);
    const extrinsicHash = ext.hash.toHex();
    log(`watched submit: extrinsic ${extrinsicHash}, waiting for ${waitFor} (timeout ${Math.round(timeoutMs / 1000)} s)`);
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (r) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ...r, extrinsicHash, statuses, elapsedMs: Date.now() - t0 });
      };
      const timer = setTimeout(() => {
        const last = statuses.at(-1)?.status ?? 'none';
        log(`watched submit: no ${waitFor} after ${since()}; last status ${last}`);
        finish({ outcome: 'Timeout', lastStatus: last });
      }, timeoutMs);
      ext
        .send((result) => {
          const s = result.status;
          const name = s.type;
          const block = s.isInBlock ? s.asInBlock.toHex() : s.isFinalized ? s.asFinalized.toHex() : undefined;
          statuses.push({ at: new Date().toISOString(), status: name, ...(block ? { block } : {}) });
          log(`watched submit: ${name}${block ? ` ${block}` : ''} after ${since()}`);
          if (name === waitFor || (waitFor === 'InBlock' && name === 'Finalized')) finish({ outcome: name, blockHash: block });
          else if (TERMINAL_FAIL.has(name)) finish({ outcome: name });
        })
        .then((u) => { unsub = u; })
        .catch((e) => {
          // The node refused the extrinsic outright (pool validation): this is the
          // most useful case, because the error carries the runtime's reason.
          const error = String(e?.message ?? e).slice(0, 400);
          statuses.push({ at: new Date().toISOString(), status: 'Rejected', error });
          log(`watched submit: rejected by the node after ${since()}: ${error}`);
          finish({ outcome: 'Rejected', error });
        });
    });
  } finally {
    try { unsub?.(); } catch {}
    await api.disconnect().catch(() => {});
  }
}

export const isWatchedSuccess = (r) => TERMINAL_OK.has(r?.outcome);
