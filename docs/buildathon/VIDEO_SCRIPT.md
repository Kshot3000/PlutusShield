# PlutusShield demo video script (Midnight Buildathon, Wave 2)

About 3 minutes. Record at 1600×900 or 1920×1080 in a desktop browser with a Cardano Preview wallet (Lace or Eternl, CIP-30) holding a little tADA. Testnet only, not audited: say so on camera.

Links used on screen (checked Oct 12–13, 2026; oracle hash from the site snapshot):

- Live site: https://kshot3000.github.io/PlutusShield/
- Guided demo (this script as a page, every step with its on-chain receipts): https://kshot3000.github.io/PlutusShield/demo/
- Cover desk: https://kshot3000.github.io/PlutusShield/cover/
- App dashboard: https://kshot3000.github.io/PlutusShield/app/
- Evidence vault: https://kshot3000.github.io/PlutusShield/claim/evidence/
- Midnight v2 contract: https://preprod.midnightexplorer.com/contracts/0x5430b803b6b3df6e6ee1d498bb02e2f2d06cb46661e72af1e6208d864feb8110
- Midnight v2 proveCover tx (policy 72512fac…): https://preprod.midnightexplorer.com/transactions/0x853bab79c11f0a5ea42ff46121efc60e32b74fe5ca07b18761b71a6f442c39ce
- 2-of-3 committee payout on Cardano: https://preview.cexplorer.io/tx/c35535dd089693d5b9676d5569a8d31b405726f7d02f782647d6afa67899ab38
- Holder-filed claim on Midnight (claim kit, exploit policy 496dced8…): https://preprod.midnightexplorer.com/transactions/0x00989a6afe372f396299c3d0807816208647d3b4907576d29ae0587e90873630
- Its 2-of-3 payout on Cardano (25 tADA, decided by v2 voteClaim): https://preview.cexplorer.io/tx/dbf0ba7a963c680354fa27eaf5e877c4dd28cb6b905885b496a51f3638ba15e0
- Exploit cover bought from the website's own Buy builder (policy 9bdef8cb…): https://preview.cexplorer.io/tx/3c1fc629474f48e2798479a3529e3332f75d73be4f5ccdd41f81886c9f547fff
- Latest oracle publish baked into the site snapshot (peg 99.78%, published Oct 13 21:26 UTC; confirmed on Preview): https://preview.cexplorer.io/tx/87ffffde153828c55c624ad39980c7a7013e937f10b22dd1c50ff9f740810ada
- Open underwriting book (no wallet): https://kshot3000.github.io/PlutusShield/book/
- Public claims register (no wallet): https://kshot3000.github.io/PlutusShield/claims/

---

## 0:00 – 0:20 · Hook (landing page)

**On screen:** the home page hero, slow scroll to the dual-chain section.

**Say:** "DeFi insurance has a privacy problem. To get covered on a public chain you publish who you are, what you hold and how much you insured. To claim, you publish your evidence. PlutusShield fixes that by splitting the job: Cardano holds the money and pays out, Midnight keeps the secrets."

## 0:20 – 0:55 · Buy cover (`/cover`)

**On screen:** open `/cover`, connect the Preview wallet, pick stablecoin depeg cover, set an amount, choose ADA or tUSDCx, buy. Open the Buy tx in cexplorer.

**Say:** "This is the cover desk on Cardano Preview. I pick depeg cover, pay the premium in ADA or test USDC, and sign with my wallet. The validator only lets me buy while the oracle feeds are fresh and the peg holds, so if the price feed goes stale for two hours or the peg breaks, sales close on their own. The policy on chain holds a hash commitment, not my terms."

*(If the wallet is slow, skip the live buy and show an existing policy on `/app`. 11 policies are live.)*

*(Optional, 5 seconds: flip to exploit cover at `/cover#buy-exploit`. Same wallet, same Buy builder, the 2-of-3 committee pool instead of oracle feeds. The policy appears in My policies labelled "Exploit (v2 committee)", with a link straight to `/claim/evidence/?policy=…`.)*

## 0:55 – 1:35 · Mirrored on Midnight (`/app`)

**On screen:** `/app`, the Midnight panel showing the policy mirrored on policy-cover v2. Click through to the contract on preprod.midnightexplorer.com and the proveCover tx.

**Say:** "A relay mirrors the policy to Midnight. registerPolicy stores a commitment to the holder and the terms. Then the holder runs proveCover, a zero-knowledge proof that says 'this policy covers at least X' without ever revealing the real limit or the wallet behind it. A protocol or a counterparty can check that I'm covered. Nobody learns my position."

## 1:35 – 2:15 · Claim with sealed evidence (`/claim/evidence`)

**On screen:** `/claim/evidence`, press "Fill with example data", seal the bundle, show the commitment. Scroll to the committee panel: three votes, two approve, PAID.

**Say:** "Exploit cover can't pay from an oracle, so claims get assessed. The evidence is encrypted right here in the browser with AES-256-GCM. Only its SHA-256 commitment goes into fileClaim on Midnight; the file goes privately to the assessors. Three committee seats vote with voteClaim. In this drill it went approve, reject, approve, and at two of three the claim is marked PAID. And this one was filed by the holder, from a passphrase-encrypted claim kit on their own machine, so our relay never held the policy key."

## 2:15 – 2:40 · Payout on Cardano

**On screen:** the Settle tx c35535dd… on preview.cexplorer.io, showing two signatures, then the Settle dbf0ba7a… for the holder-filed claim.

**Say:** "The decision comes back to Cardano. This Settle paid 50 test ADA, and it carries two of the three assessor signatures because the exploit pool's validator requires them. We tried a one-of-three payout too: the validator rejects it, so no single key can push money out. This second Settle paid the holder-filed claim, 25 test ADA, after the v2 committee voted it through on Midnight."

## 2:40 – 3:00 · Honest status and what's next

**On screen:** the README Buildathon section or deck slide 9, then the repo.

**Say:** "Everything you saw is on testnet and not audited yet. The three committee seats are run by us today, and the repo already has the kit for independent assessors to enroll. Holders already file claims from their own machine with a passphrase-encrypted claim kit, so the relay never holds their key. Lace Midnight connect is live, and /claim/evidence File with Lace drives proveCover and fileClaim: the holder prove bridge builds and proves the Compact call with midnight-js on the local proof server and hands Lace the proven transaction to balance and submit. Until the first finalized submit through that path, holders file with the claim kit. Exploit cover itself is bought in the browser on /cover, the same way as depeg cover. Next: the same submit from Lace itself in a browser, independent assessors on the three seats, an audit, then a capped mainnet launch. The code, tests and all the transactions are linked in the repo. Thanks for watching."

---

## Optional · 15 seconds for judges who click instead of watch

**On screen:** `/book`, then `/claims`.

**Say:** "If you are judging from the repo, open the underwriting book and the claims register. Every live Preview pool is scored in the open — tier B, capital, utilization — and every decided claim links to its Cardano and Midnight transactions. No wallet needed."

---

## Recording checklist

- [ ] Preview wallet funded with tADA (and tUSDCx if showing a USDC premium).
- [ ] Hard-refresh the site before recording so the latest build loads.
- [ ] Check `/app` shows the Midnight panels live; if Blockfrost is slow it falls back to the build-time snapshot, which is fine to show.
- [ ] Keep the browser zoom at 100% and hide bookmarks and extensions you don't need on screen.
- [ ] Say "testnet only, not audited" out loud.
