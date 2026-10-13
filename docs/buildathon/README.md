# Midnight Buildathon · Wave 2 kit

- [`PlutusShield-Wave2-deck.pdf`](./PlutusShield-Wave2-deck.pdf) and [`.pptx`](./PlutusShield-Wave2-deck.pptx): the 10-slide pitch deck. Rebuild with [`build_deck.py`](./build_deck.py) (python-pptx), screenshots in [`shots/`](./shots).
- [`VIDEO_SCRIPT.md`](./VIDEO_SCRIPT.md): the 3-minute demo script with timings, narration and the links to open on camera.
- [`WAVE2_PROGRESS.md`](./WAVE2_PROGRESS.md): paste-ready description of Wave 2 progress for the AKINDO submission form.
- Live guided demo: [kshot3000.github.io/PlutusShield/demo](https://kshot3000.github.io/PlutusShield/demo/) walks the same five beats as the script on the site, with a CTA into each page (`/cover`, `/app`, `/claim/evidence`) and the Cardano Preview and Midnight Preprod transactions behind every step. Handy for judges who want to click through rather than watch.
- Extra judge surfaces (public, no wallet required): [underwriting book](https://kshot3000.github.io/PlutusShield/book/), [claims register](https://kshot3000.github.io/PlutusShield/claims/), [systems status](https://kshot3000.github.io/PlutusShield/status/), [assessors](https://kshot3000.github.io/PlutusShield/assessors/).
- Contract addresses, transactions and how to run everything: the Buildathon section of the [root README](../../README.md).
- **License (Buildathon):** Midnight-related code under [`contracts/midnight/`](../../contracts/midnight/) is [Apache-2.0](../../contracts/midnight/LICENSE). The rest of the monorepo stays [MIT](../../LICENSE). See the root [License](../../README.md#license) section.

Every number in the deck comes from the deployment records in `contracts/*/deployments` and the test suite. Testnet only (Cardano Preview, Midnight Preprod), not audited.

Before submitting on AKINDO (due Oct 17, 2026):

- [x] License: Midnight Compact + evaluation tooling is Apache-2.0 (`contracts/midnight/`); Cardano / site / SDK remain MIT. Matches the Buildathon rule that Midnight-related code must be under Apache-2.0 while pre-existing / independent code may keep its license.
- [ ] Record the demo video from the script and upload it.
- [ ] Submit with the deck PDF, the video link, the repo, the live site, and the Wave 2 progress text.
