// pnpm browser-e2e <deposit|withdraw> <amount> <tranche 0|1>
// pnpm browser-e2e buy <coverage> <tranche 0|1> [days=14]
//   E2E_DECLINE_SIGN=1: the wallet declines to sign (nothing is spent); checks the Midnight policy key
//   was already saved to localStorage before the prompt.
// pnpm browser-e2e policies                         My policies: per-policy claim / release action column
//   E2E_POLICY_KEY=<policy key json> also restores that Midnight key into its row from the file,
//   checks the row turns "On this device", and exports + inspects an encrypted backup.
//   needs: a static build served at $SITE (default http://127.0.0.1:8765/PlutusShield),
//   playwright-core ($PLAYWRIGHT_CORE, default "playwright-core") and a Chromium ($CHROME_PATH).
//
// Headless e2e of the /pool LP panel and the /cover Buy panel: a mock CIP-30 wallet whose signing is
// bridged to Node (deployer key, never in the page). Exercises the real static
// build, including the lazily-loaded Lucid WASM chunk, against Cardano Preview.
import { readFileSync } from "node:fs";
import { CML, Koios, Lucid, assetsToValue, utxoToCore } from "@lucid-evolution/lucid";

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const SITE = process.env.SITE ?? "http://127.0.0.1:8765/PlutusShield";
const [, , mode = "deposit", amount = "5", tranche = "0", days = "14"] = process.argv;
const sk = readFileSync(new URL("../.keys/deployer.sk", import.meta.url), "utf8").trim();
const lucid = await Lucid(new Koios("https://preview.koios.rest/api/v1"), "Preview");
lucid.selectWallet.fromPrivateKey(sk);
const addr = await lucid.wallet().address();
const addrHex = CML.Address.from_bech32(addr).to_hex();

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.exposeFunction("__e2e", async (method, arg) => {
  const w = lucid.wallet();
  if (method === "getUtxos") return (await w.getUtxos()).map((u) => utxoToCore(u).to_cbor_hex());
  if (method === "getBalance") {
    const total = {};
    for (const u of await w.getUtxos()) for (const [k, v] of Object.entries(u.assets)) total[k] = (total[k] ?? 0n) + v;
    return assetsToValue(total).to_cbor_hex();
  }
  if (method === "signTx") {
    if (process.env.E2E_DECLINE_SIGN === "1") throw new Error("user declined to sign (E2E_DECLINE_SIGN)");
    return (await w.signTx(CML.Transaction.from_cbor_hex(arg))).to_cbor_hex();
  }
  if (method === "submitTx") {
    try {
      return await w.submitTx(arg);
    } catch (e) {
      console.error(`[node] submitTx failed: ${String(e?.message ?? e).slice(0, 2000)}`);
      throw e;
    }
  }
  throw new Error(`unknown ${method}`);
});
await page.addInitScript(({ addrHex }) => {
  const call = (m, a) => window.__e2e(m, a);
  const api = {
    getNetworkId: async () => 0,
    getExtensions: async () => [],
    getUtxos: async () => call("getUtxos"),
    getCollateral: async () => [],
    getBalance: async () => call("getBalance"),
    getChangeAddress: async () => addrHex,
    getUsedAddresses: async () => [addrHex],
    getUnusedAddresses: async () => [],
    getRewardAddresses: async () => [],
    signTx: async (tx) => call("signTx", tx),
    signData: async () => { throw new Error("not in e2e"); },
    submitTx: async (tx) => call("submitTx", tx),
    experimental: {},
  };
  window.cardano = { e2e: { name: "E2E Wallet", apiVersion: "0.1.0", enable: async () => api, isEnabled: async () => true } };
  localStorage.setItem("plutusshield.wallet", "e2e");
}, { addrHex });

// Public Koios only sends CORS headers to koios.rest, so stand in for a
// CORS-enabled Preview API (what a Blockfrost project id gives the live site).
// Requests are forwarded verbatim; we record any tracing header that leaks.
const leaked = [];
await page.route("https://preview.koios.rest/**", async (route) => {
  const req = route.request();
  const h = req.headers();
  if (h.traceparent) leaked.push(req.url());
  if (req.method() === "OPTIONS")
    return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "Content-Type, Accept, Authorization", "access-control-allow-methods": "GET, POST" } });
  const r = await fetch(req.url(), { method: req.method(), headers: { "content-type": h["content-type"] ?? "application/json", accept: h.accept ?? "application/json" }, body: req.postData() ?? undefined });
  return route.fulfill({ status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "application/json", "access-control-allow-origin": "*" }, body: Buffer.from(await r.arrayBuffer()) });
});

if (mode === "policies") {
  // /cover "My policies": every row gets an Action cell from the shared claim builder's checks.
  await page.goto(`${SITE}/cover/`, { waitUntil: "networkidle" });
  await page.waitForSelector("#my-policies tbody tr", { timeout: 45000 });
  await page.waitForFunction(() => [...document.querySelectorAll("#my-policies tbody tr td:last-child")].every((td) => td.textContent.trim().length > 0), null, { timeout: 30000 });
  const actions = await page.locator("#my-policies tbody tr td:last-child").allInnerTexts();
  let midnight = null;
  if (process.env.E2E_POLICY_KEY) {
    const key = JSON.parse(readFileSync(process.env.E2E_POLICY_KEY, "utf8"));
    const row = page.locator("#my-policies tbody tr", { has: page.locator(`a[href*="${key.txHash}"]`) });
    await row.waitFor({ timeout: 30000 });
    const cell = row.locator("td").nth(5);
    const before = (await cell.innerText()).split("\n")[0];
    await cell.locator('input[type="file"]').setInputFiles(process.env.E2E_POLICY_KEY);
    await cell.getByText("On this device").waitFor({ timeout: 15000 });
    const stored = await page.evaluate((id) => JSON.parse(localStorage.getItem("plutusshield:policy-keys:v1") ?? "{}")[id]?.registrationCommitment ?? null, key.policyId);
    await cell.getByRole("button", { name: /encrypted backup/i }).click();
    await cell.getByPlaceholder("Passphrase", { exact: true }).fill("e2e passphrase 123");
    await cell.getByPlaceholder("Repeat passphrase").fill("e2e passphrase 123");
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), cell.getByRole("button", { name: /Encrypted backup/ }).click()]);
    const env = JSON.parse(readFileSync(await dl.path(), "utf8"));
    midnight = {
      before,
      after: (await cell.innerText()).split("\n")[0],
      storedMatchesKey: stored === key.registrationCommitment,
      download: dl.suggestedFilename(),
      envelope: { schema: env.schema, kdf: env.kdf?.name, iterations: env.kdf?.iterations, policyId: env.policyId === key.policyId, leaksSecret: JSON.stringify(env).includes(key.holderSecret) },
    };
  }
  await page.locator("#my-policies").scrollIntoViewIfNeeded();
  await page.locator("#my-policies").screenshot({ path: "/tmp/plutusshield-my-policies.png" });
  const keys = await page.locator("#my-policies tbody tr td:nth-child(6)").allInnerTexts();
  console.log(JSON.stringify({ rows: actions.length, actions, midnightKeys: keys.map((k) => k.split("\n")[0]), midnight }));
  console.log(logs.filter((l) => /error|warn/i.test(l)).slice(0, 15).join("\n"));
  await browser.close();
  process.exit(actions.length ? 0 : 1);
}

if (mode === "buy") {
  // /cover: currency, coverage, term, oracle check, sign, then My policies.
  await page.goto(`${SITE}/cover/`, { waitUntil: "networkidle" });
  await page.getByText("Buy USDM depeg cover").waitFor();
  await page.waitForSelector("text=Wallet:", { timeout: 20000 }).catch(() => {});
  const policyRows = () => page.locator("#my-policies tbody tr").count();
  await page.waitForSelector("#my-policies tbody tr, #my-policies >> text=No policies for this wallet", { timeout: 30000 }).catch(() => {});
  const rowsBefore = await policyRows();
  if (tranche === "1") await page.locator('input[name="buy-currency"]').nth(1).check({ force: true });
  await page.fill("#buy-coverage", amount);
  const section = page.locator("section[aria-labelledby=buy-title]");
  const chip = section.getByRole("button", { name: `${days}d`, exact: true });
  if (await chip.count()) await chip.click();
  else
    await page.locator("#buy-term").evaluate((el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, days);
  const oracle = await page.locator("text=Oracle check (sale circuit-breaker)").locator("..").innerText();
  const btn = page.getByRole("button", { name: /^Buy cover/ });
  await btn.waitFor();
  const quoted = await btn.innerText();
  await page.locator("#buy-coverage").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/plutusshield-buy-before.png" });
  if (await btn.isDisabled()) {
    console.log(JSON.stringify({ res: "button disabled", quoted, oracle }));
    await browser.close();
    process.exit(2);
  }
  await btn.click();
  const done = page.locator("text=/Covered .* for \\d+ days/");
  const err = page.locator("section[aria-labelledby=buy-title] p.text-\\[var\\(--danger\\)\\]");
  const res = await Promise.race([
    done.waitFor({ timeout: 360000 }).then(() => "done"),
    err.first().waitFor({ timeout: 360000 }).then(async () => `error: ${await err.first().innerText()}`),
  ]);
  const storedKeys = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("plutusshield:policy-keys:v1") ?? "{}")).map((k) => ({ policyId: k.policyId, coverage: k.coverage, txHash: k.txHash ?? null, registrationCommitment: k.registrationCommitment })));
  if (process.env.E2E_DECLINE_SIGN === "1") {
    console.log(JSON.stringify({ res, quoted, storedKeys }));
    await browser.close();
    process.exit(res.startsWith("error") && storedKeys.length > 0 ? 0 : 1);
  }
  const txLink = await page.locator('section[aria-labelledby=buy-title] a[href*="cardanoscan.io/transaction/"]').last().getAttribute("href").catch(() => null);
  // The confirmed tx triggers a chain re-read; wait for the new policy row.
  let rowsAfter = rowsBefore;
  for (let i = 0; i < 20 && res === "done" && rowsAfter <= rowsBefore; i++) {
    await page.waitForTimeout(3000);
    if (i % 3 === 2) await page.locator("#my-policies").getByRole("button", { name: "Refresh" }).click().catch(() => {});
    rowsAfter = await policyRows();
  }
  await page.locator("#buy-title").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/plutusshield-buy-after.png", fullPage: true });
  const backup = res === "done" ? await page.locator("text=Midnight policy key").first().isVisible().catch(() => false) : null;
  console.log(JSON.stringify({ res, quoted, txLink, rowsBefore, rowsAfter, storedKeys, backupPanel: backup, oracle: oracle.replace(/\n/g, " | "), text: res === "done" ? await done.innerText() : null }));
  console.log(logs.filter((l) => /error|warn/i.test(l)).slice(0, 15).join("\n"));
  await browser.close();
  process.exit(res === "done" ? 0 : 1);
}

await page.goto(`${SITE}/pool/`, { waitUntil: "networkidle" });
await page.getByText("Provide liquidity on Preview").waitFor();
if (mode === "withdraw") await page.getByRole("tab", { name: "withdraw" }).click();
if (tranche === "1") await page.locator('input[name="lp-tranche"]').nth(1).check({ force: true });
await page.waitForSelector("text=Wallet:", { timeout: 20000 }).catch(() => {});
await page.fill("#lp-live-amount", amount);
const btn = page.getByRole("button", { name: mode === "deposit" ? "Sign & deposit" : "Sign & withdraw" });
await btn.waitFor();
await page.locator("#lp-live-amount").scrollIntoViewIfNeeded();
await page.screenshot({ path: `/tmp/plutusshield-lp-${mode}-before.png` });
await btn.click();
const done = page.locator(mode === "deposit" ? "text=/Deposited .* minted/" : "text=/Burned .* shares for/");
const err = page.locator("p.text-\\[var\\(--danger\\)\\]");
const res = await Promise.race([
  done.waitFor({ timeout: 360000 }).then(() => "done"),
  err.first().waitFor({ timeout: 360000 }).then(async () => `error: ${await err.first().innerText()}`),
]);
const txLink = await page.locator('a:has-text("View tx")').getAttribute("href").catch(() => null);
await page.locator("text=Provide liquidity on Preview").scrollIntoViewIfNeeded();
await page.screenshot({ path: `/tmp/plutusshield-lp-${mode}-after.png` });
console.log(JSON.stringify({ res, txLink, leakedTraceparent: leaked.length, text: res === "done" ? await done.innerText() : null }));
console.log(logs.filter((l) => /error|warn/i.test(l)).slice(0, 15).join("\n"));
await browser.close();
