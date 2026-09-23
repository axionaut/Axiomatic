# AXIOMATIC

A causal world engine. Simulate civilization from a handful of rules, trace any outcome back to its causes, change one thing and rerun history.

See [CONCEPT.md](CONCEPT.md) for the idea in full.

## What the v0 prototype does

- **564 statistical cells** stand in for billions of people. Each cell holds trait distributions: education, skill, creativity, risk appetite, capital access and connectivity.
- **Real technologies:** the world starts in 1900 with 46 real technologies. 92 real later inventions (radio through large language models) each sit at a fixed point of the idea landscape: the combination of their two key ingredients, for example Transistor = Quantum mechanics + Vacuum tube. Importance comes from Wikipedia coverage via Wikidata (CC0). Every other combination is marked **speculative**. A real-history check compares the simulated order of inventions with our world's.
- **Ideas are combinations** of existing technologies. Only the adjacent possible is evaluated. Most combinations are worthless or already exist; a few are valuable, following a heavy-tailed distribution.
- **Materialisation:** when an idea succeeds or a firm is founded, the originating person is sampled from the cell, conditioned on having done it. Everyone else is never computed individually.
- **Causal trace:** every technology, person and firm opens into an expandable ancestry tree. Each link is tagged **RECORDED** (computed when it happened) or **RECONSTRUCTED** (sampled afterwards to stay consistent with the record).
- **Rewind and fork:** the world is fully deterministic. Add interventions (education, capital, connectivity, war or disaster, boosting a technology, preventing a technology) and replay with the same chance seed.
- **Many worlds:** paired ensembles give an intervention's effect with a spread. They also show which technologies are attractors (appear in ≥80% of worlds) and which are contingent (≤25%).
- **Idea frontier:** lists every valuable combination nobody has made yet. Each is scored by potential (its own value plus the value of the ideas it would unlock) and by how achievable it is in the best-placed region. It also names the bottleneck: knowledge, capability or capital.
- **Test an idea in many worlds:** branches paired futures from the current year, with and without the idea brought into existence now. It measures the effect on output per head, how much later work is built on it, and whether the world would have found it on its own.
- **Unrealised potential:** valuable ideas that kept dying, broken down by bottleneck (capability or capital).

## Run

Static files only; no build step. Serve the folder over HTTP (the ensemble uses a Web Worker):

```
python -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly from disk also works; ensembles then run on the main thread.

## Files

| File | Role |
|---|---|
| `engine.js` | Deterministic simulation: universe, world, materialisation, biography, ensembles. No DOM; also runs in Node. |
| `app.js` | UI: map, transport, inspector, causal tree, counterfactuals, charts. |
| `worker.js` | Runs ensembles off the main thread. |
| `data/techgraph.js` | Generated real technology graph. Rebuild with `node tools/build-techgraph.js` after editing `tools/techs.src.js`. |
| `index.html`, `styles.css`, `favicon.svg` | Page, styling and icon. |
