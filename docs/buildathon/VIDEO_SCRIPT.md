# PlutusShield demo video script (Midnight Buildathon, Wave 2)

About 3 minutes. Record at 1600×900 or 1920×1080 in a desktop browser with a Cardano Preview wallet (Lace or Eternl, CIP-30) holding a little tADA. Testnet only, not audited: say so on camera.

Links used on screen (all checked Oct 12, 2026):

- Live site: https://kshot3000.github.io/PlutusShield/
- Guided demo (this script as a page, every step with its on-chain receipts): https://kshot3000.github.io/PlutusShield/demo/
- Cover desk: https://kshot3000.github.io/PlutusShield/cover/
- App dashboard: https://kshot3000.github.io/PlutusShield/app/
- Evidence vault: https://kshot3000.github.io/PlutusShield/claim/evidence/
- Midnight v2 contract: https://preprod.midnightexplorer.com/contracts/0x5430b803b6b3df6e6ee1d498bb02e2f2d06cb46661e72af1e6208d864feb8110
- Midnight v2 proveCover tx (policy 72512fac…): https://preprod.midnightexplorer.com/transactions/0x853bab79c11f0a5ea42ff46121efc60e32b74fe5ca07b18761b71a6f442c39ce
- 2-of-3 committee payout on Cardano: https://preview.cexplorer.io/tx/c35535dd089693d5b9676d5569a8d31b405726f7d02f782647d6afa67899ab38
- Latest oracle publish (peg 99.77%, published Oct 12 14:11 UTC; confirmed on Preview, checked Oct 12, 2026): https://preview.cexplorer.io/tx/b2e0fbe6efef3a5fdad0b135f6968172ff509e0ddcf7c61f6205de4b5ab81b29

---

## 0:00 – 0:20 · Hook (landing page)

**On screen:** the home page hero, slow scroll to the dual-chain section.

**Say:** "DeFi insurance has a privacy problem. To get covered on a public chain you publish who you are, what you hold and how much you insured. To claim, you publish your evidence. PlutusShield fixes that by splitting the job: Cardano holds the money and pays out, Midnight keeps the secrets."

## 0:20 – 0:55 · Buy cover (`/cover`)

**On screen:** open `/cover`, connect the Preview wallet, pick stablecoin depeg cover, set an amount, choose ADA or tUSDCx, buy. Open the Buy tx in cexplorer.

**Say:** "This is the cover desk on Cardano Preview. I pick depeg cover, pay the premium in ADA or test USDC, and sign with my wallet. The validator only lets me buy while the oracle feeds are fresh and the peg holds, so if the price feed goes stale for two hours or the peg breaks, sales close on their own. The policy on chain holds a hash commitment, not my terms."

*(If the wallet is slow, skip the live buy and show an existing policy on `/app`. 11 policies are live.)*

## 0:55 – 1:35 · Mirrored on Midnight (`/app`)

**On screen:** `/app`, the Midnight panel showing the policy mirrored on policy-cover v2. Click through to the contract on preprod.midnightexplorer.com and the proveCover tx.

**Say:** "A relay mirrors the policy to Midnight. registerPolicy stores a commitment to the holder and the terms. Then the holder runs proveCover, a zero-knowledge proof that says 'this policy covers at least X' without ever revealing the real limit or the wallet behind it. A protocol or a counterparty can check that I'm covered. Nobody learns my position."

## 1:35 – 2:15 · Claim with sealed evidence (`/claim/evidence`)

**On screen:** `/claim/evidence`, press "Fill with example data", seal the bundle, show the commitment. Scroll to the committee panel: three votes, two approve, PAID.

**Say:** "Exploit cover can't pay from an oracle, so claims get assessed. The evidence is encrypted right here in the browser with AES-256-GCM. Only its SHA-256 commitment goes into fileClaim on Midnight; the file goes privately to the assessors. Three committee seats vote with voteClaim. In this drill it went approve, reject, approve, and at two of three the claim is marked PAID."

## 2:15 – 2:40 · Payout on Cardano

**On screen:** the Settle tx c35535dd… on preview.cexplorer.io, showing two signatures.

**Say:** "The decision comes back to Cardano. This Settle paid 50 test ADA, and it carries two of the three assessor signatures because the exploit pool's validator requires them. We tried a one-of-three payout too: the validator rejects it, so no single key can push money out."

## 2:40 – 3:00 · Honest status and what's next

**On screen:** the README Buildathon section or deck slide 9, then the repo.

**Say:** "Everything you saw is on testnet and not audited yet. The three committee seats are run by us today, and the repo already has the kit for independent assessors to enroll. Holders already file claims from their own machine with a passphrase-encrypted claim kit, so the relay never holds their key. Next up: proveCover and fileClaim straight from the browser wallet, an audit, then a capped mainnet launch. The code, 305 tests and all the transactions are linked in the repo. Thanks for watching."

---

## Recording checklist

- [ ] Preview wallet funded with tADA (and tUSDCx if showing a USDC premium).
- [ ] Hard-refresh the site before recording so the latest build loads.
- [ ] Check `/app` shows the Midnight panels live; if Blockfrost is slow it falls back to the build-time snapshot, which is fine to show.
- [ ] Keep the browser zoom at 100% and hide bookmarks and extensions you don't need on screen.
- [ ] Say "testnet only, not audited" out loud.
