/* Runs many-world ensembles off the main thread. */
importScripts('engine.js');
self.onmessage = e => {
  const { us, seeds, ivs, years } = e.data;
  const res = self.Axiomatic.runEnsemble(us, seeds, ivs, years, p => self.postMessage({ progress: p }));
  self.postMessage({ result: res });
};
