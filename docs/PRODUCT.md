# Product

## Who it’s for

| Stakeholder | Job to be done |
|---|---|
| **Cover buyers** | Hedge protocol / position risk without exposing size or strategy |
| **Underwriters / LPs** | Earn premium by funding a risk pool with clear rules |
| **Protocols / partners** | Offer one-click cover inside their own flows |
| **Assessors / auditors** | Review exploit claims with selective disclosure, not public dumps |

## Cover types

### 1. Smart-contract exploit / hack cover
Evidence-based. Buyer submits private evidence on Midnight. Assessors review under disclosure proofs. Approved claims settle on Cardano from the pool.

### 2. Parametric DeFi events
Objective triggers: depeg thresholds, oracle staleness / deviation, liquidation events published by authenticated feeds. Payout is automatic when the on-chain condition fires — no claims committee.

### 3. Protocol SLA cover
Measurable downtime or service-level breach (batcher, oracle, bridge). Trigger definition is part of the policy terms.

## UX pillars

1. **Quote in one screen** — risk, premium, coverage, duration, clear exclusions.
2. **Wallet-native** — Lace / CIP-30 style connect; no custodial checkout for MVP.
3. **Status you can trust** — policy live / expired / claimed / paid, tied to on-chain refs.
4. **Privacy without mystery** — show what is public vs private at every step.
5. **Partner-ready** — SDK path so other protocols can attach cover in the same tx where possible.

## Pricing principles (design)

- Parametric products priced from historical trigger frequency, pool utilization, and oracle quality.
- Exploit cover priced higher, with protocol allowlists and coverage caps.
- Minimum premium floor and per-policy caps protect the pool from adverse selection.

Exact formulas ship with the quote engine; they are not finalized in this doc.
