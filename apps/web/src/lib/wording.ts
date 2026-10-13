/**
 * Cover wording for the two live products, built at build time from the same
 * deployment records the buy flow uses, so the terms page can never quote a
 * number the validator doesn't enforce.
 */
import { coverWording, type WordingParamsJson } from "@plutusshield/sdk/wording";
import depegArtifact from "@/data/preview-deployment.json";
import exploitArtifact from "@/data/preview-exploit-v2-deployment.json";

export const DEPEG_WORDING = coverWording({
  product: "depeg",
  params: depegArtifact.params as WordingParamsJson,
  network: "Cardano Preview",
  source: "contracts/cardano/deploy/deployments/preview.json",
});

export const EXPLOIT_WORDING = coverWording({
  product: "exploit",
  params: exploitArtifact.params as WordingParamsJson,
  committee: { threshold: Number(exploitArtifact.committee.threshold), seats: exploitArtifact.committee.assessors.length },
  network: "Cardano Preview + Midnight Preprod",
  source: "contracts/cardano/deploy/deployments/preview-exploit-v2.json",
});

export const WORDINGS = [DEPEG_WORDING, EXPLOIT_WORDING];
