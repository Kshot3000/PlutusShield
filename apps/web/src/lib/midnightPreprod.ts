/**
 * Public facts about the live Midnight Preprod deployment of policy-cover.compact.
 * Source: contracts/midnight/deployments/preprod.json (written by
 * contracts/midnight/preprod/policy-cover-preprod.mjs from finalized tx data).
 * Every value here is public; no keys or holder secrets.
 */
export type ClaimDrill = {
  policyId: string;
  cardanoBuyTx: string;
  cover: string;
  evidenceCommitment: string;
  fileClaim: { txHash: string; block: number };
  resolveClaim: { txHash: string; block: number; approved: boolean };
};

export const MIDNIGHT_PREPROD = {
  network: "Midnight Preprod",
  compiler: "compactc 0.31.1",
  contractAddress: "d84c618775ffa4d9c2e9283b6fe95319cecd708e84742c27ec4b6762925e8787",
  deployTxId: "00503906dc2fbaab04afe697d7e1c8074e28106a5f40a8485beb973d9833cd6290",
  deployBlock: 2865271,
  deployedAt: "2026-10-06T17:57:50.963Z",
  firstPolicy: {
    cardanoBuyTx: "7c3365bb519dfdaca6e12a371b35e0c1b7ffd321bec42130021e22b47c31386d",
    coverageAda: 50,
    midnightCommitment: "d9f979b5d5d1733745f319f8941d9aa3d593491907dea81bd7067a622516e62b",
    registerPolicy: { txHash: "151a5ede0f1a87d784d1b2a541b9bfc3b00895a36db853ccf4df036be544300e", block: 2865275 },
    proveCover: { txHash: "dee4fe6cdd05eb59dd28e2787f66de2ae6198339d2f33cc4130cedd762247b6c", block: 2865279 },
  },
  ledger: { activePolicies: 1, coverProofs: 1 },
  /** Exploit-claims drill on Preprod (demo evidence, test policies), from deployments/preprod.json `claims`. */
  claimsDrill: [
    {
      policyId: "72512facd0a8eb5257888b8f3b0ee71b774862cc7f4c7d7cc4f124c6f6d745d0",
      cardanoBuyTx: "7c3365bb519dfdaca6e12a371b35e0c1b7ffd321bec42130021e22b47c31386d",
      cover: "USDM depeg cover · 50 tADA",
      evidenceCommitment: "ca7e8da3bd36b464fcf670687f690d8e2276c08d694773c88d7ced5399622b30",
      fileClaim: { txHash: "b5120dd0b2268c7459128f68a4fc958a8e8710c4b5f5e6b6debcb674d20ba1af", block: 2867361 },
      resolveClaim: { txHash: "cdd32797f1f73c4f0c21e7d20fc56b2a59a372640d324bfcaf4354fe9b632511", block: 2867365, approved: true },
    },
    {
      policyId: "a33af8052854e2b4b32bff59afcb652dc0240bcb19b231314685bfaed13b2b3d",
      cardanoBuyTx: "1e70f0895de64c50dbbc39df0e8d23af362a29e476d1bdfb1e2068ff780f321f",
      cover: "USDM depeg cover · 20 tADA",
      evidenceCommitment: "dcdd60be82a7f163ac38021a477b1bd84e3f0442cdcbb4d7e3243caecaa13721",
      fileClaim: { txHash: "e9878f893cac9a9a47ae6a30bf2ffe5a9595c24a419c12e03b1310830e695425", block: 2867368 },
      resolveClaim: { txHash: "e7a4b0e24740eab11b0ec7222640f0ae316427fe7519b30705407856339b9a68", block: 2867372, approved: false },
    },
  ] as ClaimDrill[],
  record: "https://github.com/Kshot3000/PlutusShield/blob/main/contracts/midnight/deployments/preprod.json",
};

export const shortHash = (h: string, n = 8) => `${h.slice(0, n)}…${h.slice(-6)}`;
