/**
 * Public facts about the live Midnight Preprod deployment of policy-cover.compact.
 * Source: contracts/midnight/deployments/preprod.json (written by
 * contracts/midnight/preprod/policy-cover-preprod.mjs from finalized tx data).
 * Every value here is public; no keys or holder secrets.
 */
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
  record: "https://github.com/Kshot3000/PlutusShield/blob/main/contracts/midnight/deployments/preprod.json",
};

export const shortHash = (h: string, n = 8) => `${h.slice(0, n)}…${h.slice(-6)}`;
