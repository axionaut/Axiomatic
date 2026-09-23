/* Runs many-world ensembles off the main thread. */
importScripts('data/techgraph.js', 'engine.js');
self.onmessage = e => {
  if (e.data.type === 'idea') {
    const d = e.data, res = self.Axiomatic.testIdea(d.us, d.seed, d.ivs, d.idea, d.now, d.n, p => self.postMessage({ progress: p }));
    return self.postMessage({ result: res });
  }
  const { us, seeds, ivs, years } = e.data;
  const res = self.Axiomatic.runEnsemble(us, seeds, ivs, years, p => self.postMessage({ progress: p }));
  self.postMessage({ result: res });
};
