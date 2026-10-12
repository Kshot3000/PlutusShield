# Midnight Buildathon · Wave 2 kit

- [`PlutusShield-Wave2-deck.pdf`](./PlutusShield-Wave2-deck.pdf) and [`.pptx`](./PlutusShield-Wave2-deck.pptx): the 10-slide pitch deck. Rebuild with [`build_deck.py`](./build_deck.py) (python-pptx), screenshots in [`shots/`](./shots).
- [`VIDEO_SCRIPT.md`](./VIDEO_SCRIPT.md): the 3-minute demo script with timings, narration and the links to open on camera.
- Live guided demo: [kshot3000.github.io/PlutusShield/demo](https://kshot3000.github.io/PlutusShield/demo/) walks the same five beats as the script on the site, with a CTA into each page (`/cover`, `/app`, `/claim/evidence`) and the Cardano Preview and Midnight Preprod transactions behind every step. Handy for judges who want to click through rather than watch.
- Contract addresses, transactions and how to run everything: the Buildathon section of the [root README](../../README.md).

Every number in the deck comes from the deployment records in `contracts/*/deployments` and the test suite. Testnet only (Cardano Preview, Midnight Preprod), not audited.

Before submitting on AKINDO (due Oct 17, 2026):

- [ ] Decide the license: the repo is MIT today and the Buildathon asks for Apache-2.0.
- [ ] Record the demo video from the script and upload it.
- [ ] Submit with the deck PDF, the video link, the repo and the live site.
