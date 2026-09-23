/* Build data/fieldprior.js: real-world evidence about which combinations of fields pay off.
 * Run locally after build-techgraph.js:  node tools/build-fieldprior.js
 *
 * Source: OpenAlex (free, CC0). Each technology is assigned a research subfield (OpenAlex subfields are
 * Scopus ASJC codes). For every subfield used, two grouped queries return how many research works are
 * tagged with it together with each other subfield, and how many of those became highly cited.
 * That gives, for any pair of fields: how related they are (co-occurrence vs chance) and how often
 * combining them has paid off (hit rate vs average).
 *
 * About 110 requests in total. Responses are cached in tools/.openalex-cache.json, so if the free daily
 * quota runs out the script stops and resumes where it left off next time.
 */
const fs = require('fs');
const path = require('path');
const TG = require('../data/techgraph.js');
const HIT = 100;   // "highly cited" = more than this many citations
const BASE = 'https://api.openalex.org';
const CACHE = path.join(__dirname, '.openalex-cache.json');

// technology -> OpenAlex subfield (ASJC code)
const FIELD = {
  plough: 1102, glass: 2503, printing: 3315, optics: 3107, microscope: 3105, calculus: 2604, calculator: 1708,
  steam: 2210, statistics: 2613, lithography: 2508, battery: 2102, vaccine: 2403, railway: 3313, electromag: 2208,
  motor: 2208, photo: 1213, telegraph: 1705, vulcan: 2507, anaesthesia: 2703, thermo: 1606, gyro: 2202,
  boolean: 2614, bessemer: 2506, orgchem: 1605, oilwell: 2103, refinery: 2103, germ: 2404, dynamite: 1508,
  generator: 2102, refrig: 2210, telephone: 1705, phonograph: 1711, bulb: 2208, piezo: 2504, turbine: 2210,
  car: 2203, ac: 2208, glider: 2202, punchcard: 1708, diesel: 2203, icengine: 2203, moviecam: 1213, xray: 2741,
  radioact: 3108, crt: 2208, vacpump: 2210,
  radio: 1705, aircon: 2215, vacuumclean: 2210, airplane: 2202, vactube: 2208, photoelec: 3104, tractor: 1102,
  cellculture: 1307, bakelite: 2507, haber: 1508, superconduct: 3104, assembly: 2209, grid: 2102, sonar: 2212,
  rocket: 2202, quantum: 3107, television: 3315, soundfilm: 1213, quartzclock: 3105, penicillin: 3004,
  magtape: 2504, neutron: 3106, polyethylene: 2507, nylon: 2507, radar: 1711, turingm: 2614, helicopter: 2202,
  jet: 2202, synthrubber: 2507, fission: 3106, nmr: 1602, xerography: 2508, reactor: 2104, eniac: 1708,
  microwave: 2208, transistor: 2208, infotheory: 1703, fracking: 2103, maser: 3107, dna: 1312, nuclearpower: 2104,
  solarcell: 2105, atomicclock: 3107, polio: 2406, container: 3313, hdd: 1708, vtr: 1711, ultrasound: 2741,
  satellite: 2202, ic: 2208, ml: 1702, laser: 3107, led: 2504, greenrev: 1102, compgraphics: 1704, packet: 1705,
  hypertext: 1710, lcd: 2504, ccd: 3105, arpanet: 1705, restriction: 1312, fiber: 3107, microprocessor: 1708,
  ctscan: 2741, mri: 2741, recombinant: 1305, mobile: 1705, barcode: 1710, monoclonal: 2403, digicam: 1707,
  publickey: 1710, pc: 1708, gps: 1711, flash: 2208, cd: 1711, internet: 1705, pcr: 1312, liion: 2102,
  www: 1710, gmcrops: 1110, searchengine: 1710, gpu: 1708, genome: 1311, socialmedia: 3315, smartphone: 1709,
  bitcoin: 2003, ev: 2203, drone: 2202, deeplearning: 1702, crispr: 1311, llm: 1702, mrna: 2403
};

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
class QuotaError extends Error {}
// only the parts of a response we keep
const slim = j => ({ meta: { count: j.meta.count }, results: j.results && j.results[0] && j.results[0].display_name ? j.results : undefined,
  group_by: (j.group_by || []).map(g => ({ key: g.key, count: g.count })) });
async function get(url) {
  if (cache[url]) return cache[url];
  for (let i = 0; i < 4; i++) {
    const r = await fetch(BASE + url);
    if (r.ok) { const j = slim(await r.json()); cache[url] = j; fs.writeFileSync(CACHE, JSON.stringify(cache)); await sleep(120); return j; }
    if (r.status === 429 && +r.headers.get('retry-after') > 120) {
      throw new QuotaError(`OpenAlex free daily quota used up; resets in about ${Math.ceil(+r.headers.get('retry-after') / 3600)} h. Run again then — progress is cached.`);
    }
    await sleep(1500 * (i + 1));
  }
  throw new Error('OpenAlex request failed: ' + url);
}

(async () => {
  const missing = TG.techs.filter(t => !FIELD[t.id]).map(t => t.id);
  if (missing.length) { console.error('No field for: ' + missing.join(', ')); process.exit(1); }
  const used = [...new Set(Object.values(FIELD))].sort((a, b) => a - b);

  // subfield names (also validates the codes)
  const subfields = {};
  for (const page of [1, 2]) {
    const j = await get(`/subfields?per_page=200&page=${page}&select=id,display_name,field`);
    for (const s of (j.results || [])) subfields[+s.id.split('/').pop()] = { name: s.display_name, field: s.field.display_name };
  }
  const bad = used.filter(id => !subfields[id]);
  if (bad.length) { console.error('Unknown subfield codes: ' + bad.join(', ')); process.exit(1); }

  const total = (await get(`/works?per_page=1&select=id`)).meta.count;
  const totalHits = (await get(`/works?filter=cited_by_count:>${HIT}&per_page=1&select=id`)).meta.count;

  // per subfield: co-tag counts with every other subfield, for all works and for highly cited works
  const pairs = {};
  for (const x of used) {
    const all = await get(`/works?filter=topics.subfield.id:${x}&group_by=topics.subfield.id&per_page=200`);
    const top = await get(`/works?filter=topics.subfield.id:${x},cited_by_count:>${HIT}&group_by=topics.subfield.id&per_page=200`);
    const hitsBy = new Map(top.group_by.map(g => [+String(g.key).split('/').pop(), g.count]));
    subfields[x].works = all.meta.count; subfields[x].hits = top.meta.count;
    for (const g of all.group_by) {
      const y = +String(g.key).split('/').pop();
      if (!used.includes(y)) continue;
      pairs[Math.min(x, y) + '|' + Math.max(x, y)] = [g.count, hitsBy.get(y) || 0];
    }
    process.stdout.write('.');
  }
  console.log();
  const keep = Object.fromEntries(used.map(id => [id, subfields[id]]));

  const file = path.join(__dirname, '..', 'data', 'fieldprior.js');
  const data = { built: new Date().toISOString().slice(0, 10), hitThreshold: HIT, total, totalHits, subfields: keep, techField: FIELD, pairs };
  fs.writeFileSync(file, `/* Generated by tools/build-fieldprior.js from OpenAlex (CC0). Do not edit by hand. */\n` +
    `(function (root) { root.AXIOMATIC_FIELDPRIOR = ${JSON.stringify(data)}; })(typeof self !== 'undefined' ? self : this);\n` +
    `if (typeof module !== 'undefined') module.exports = (typeof self !== 'undefined' ? self : this).AXIOMATIC_FIELDPRIOR;\n`);
  console.log(`wrote ${used.length} subfields and ${Object.keys(pairs).length} field pairs to data/fieldprior.js`);
})().catch(e => { console.error(e.message); process.exit(e instanceof QuotaError ? 2 : 1); });
