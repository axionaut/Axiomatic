/* Axiomatic engine — deterministic causal world. No DOM; runs in page, worker or node.
 *
 * Universe seed = the axioms (geography, starting conditions, which idea combinations are
 * valuable). History seed = chance. Every random draw is a pure hash of
 * (seed, tick, cell, stream, index), so rewinding replays exactly and a fork differs
 * only where a cause differs (common random numbers).
 */
(function (root) {
  'use strict';

  const W = 48, H = 28, C = W * H;
  const MAXT = 1000;              // technology slots per world
  // Time is anchored to the present. The past runs from the start of the real data (the 1900 toolkit)
  // up to now, where it can be checked against our world; the future is a projection FUTURE years ahead.
  const START_YEAR = 1900, FUTURE = 50;
  const PRESENT = (root.AXIOMATIC_PRESENT | 0) || new Date().getFullYear();
  const NOW_T = PRESENT - START_YEAR, YEARS = NOW_T + FUTURE, END_YEAR = START_YEAR + YEARS;
  // a year described relative to the present
  function rel(y) {
    const d = y - PRESENT, n = Math.abs(d);
    return d === 0 ? 'now' : d < 0 ? `${n} year${n === 1 ? '' : 's'} ago` : `in ${n} year${n === 1 ? '' : 's'}`;
  }
  const P = { inv: 0.05, firm: 0.03, related: 0.7 };

  const PREFIX = ['Steam', 'Electro', 'Hydro', 'Aero', 'Bio', 'Photo', 'Magneto', 'Thermo', 'Micro', 'Poly',
    'Nano', 'Quantum', 'Crypto', 'Geo', 'Chrono', 'Sono', 'Cyto', 'Litho', 'Radio', 'Petro'];
  const NOUN = ['engine', 'loom', 'press', 'cell', 'grid', 'lens', 'alloy', 'reactor', 'network', 'vaccine',
    'ledger', 'turbine', 'circuit', 'polymer', 'drive', 'scope', 'forge', 'relay', 'furnace', 'compass',
    'assay', 'clock', 'pump', 'kiln', 'cable', 'sensor', 'battery', 'solvent', 'mill', 'protocol'];
  const SYL = ['ka', 'ri', 'to', 'ma', 'sen', 'vel', 'dor', 'an', 'ush', 'el', 'mi', 'ra', 'zo', 'tan',
    'bel', 'or', 'is', 'lu', 'qa', 'nev', 'sol', 'tir', 'ade', 'hon'];
  const FIRM_SUFFIX = ['Works', '& Co', 'Industries', 'Labs', 'Systems', 'Holdings', 'Collective', 'Group'];
  const TRAITS = ['education', 'skill', 'creativity', 'risk', 'capital'];

  // ---------- deterministic randomness ----------
  function mix(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16; return h >>> 0;
  }
  function hash4(a, b, c, d) {
    let h = mix((a | 0) ^ 0x9e3779b9);
    h = mix(h ^ (b | 0));
    h = mix(((h + 0x632be5ab) | 0) ^ (c | 0));
    return mix(h ^ (d | 0) ^ 0x85ebca6b);
  }
  const rnd = (a, b, c, d) => hash4(a, b, c, d) / 4294967296;
  function gauss(a, b, c, d) {
    const u = 1 - rnd(a, b, c, d), v = rnd(a, b, c, d ^ 0x5bd1e995);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * v);
  }
  const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
  const normCdf = z => 1 / (1 + Math.exp(-1.702 * z));
  function poisson(lam, u, u2) {
    if (lam <= 0) return 0;
    if (lam > 40) {
      const z = Math.sqrt(-2 * Math.log(1 - u)) * Math.cos(6.283185307179586 * u2);
      return Math.max(0, Math.round(lam + Math.sqrt(lam) * z));
    }
    let k = 0, p = Math.exp(-lam), cdf = p;
    while (u > cdf && k < 200) { k++; p *= lam / k; cdf += p; }
    return k;
  }
  const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);

  // ---------- the idea landscape (universe-level, identical across histories) ----------
  const pairHash = (ha, hb) => (ha < hb ? hash4(0x51ed270b, ha, hb, 0x1f) : hash4(0x51ed270b, hb, ha, 0x1f));
  function strHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
    return mix(h);
  }

  // Real technologies (data/techgraph.js, curated + Wikidata). Axioms are the 1900 toolkit; every later
  // real technology is the combination of its two key ingredients, so it sits at a fixed point of the
  // idea landscape. Every other combination is speculative.
  const TG = root.AXIOMATIC_TECHGRAPH || (typeof require === 'function' ? require('./data/techgraph.js') : null);
  if (!TG) throw new Error('Axiomatic: load data/techgraph.js before engine.js');
  const REAL = { axioms: [], byHash: new Map(), partners: new Map(), inventions: 0 };
  (() => {
    const hashOf = new Map();
    const link = (x, y) => { if (!REAL.partners.has(x)) REAL.partners.set(x, []); REAL.partners.get(x).push(y); };
    for (const t of TG.techs) {
      if (!t.parents.length) {
        const h = strHash('axiom:' + t.id);
        hashOf.set(t.id, h); REAL.axioms.push({ ...t, h }); REAL.byHash.set(h, t);
        continue;
      }
      const ha = hashOf.get(t.parents[0]), hb = hashOf.get(t.parents[1]), h = pairHash(ha, hb);
      hashOf.set(t.id, h); REAL.byHash.set(h, t); REAL.inventions++;
      link(ha, hb); link(hb, ha);
    }
  })();
  const NB = REAL.axioms.length;   // axioms: technologies that exist at t = 0

  // Field evidence (data/fieldprior.js, OpenAlex): for two research subfields, how often research has
  // combined them (vs chance) and how often those combinations became highly cited (vs average).
  // Optional — without it, speculative ideas fall back to a field-blind prior.
  const FP = root.AXIOMATIC_FIELDPRIOR || (typeof require === 'function' ? (() => { try { return require('./data/fieldprior.js'); } catch (e) { return null; } })() : null);
  const realField = t => (FP && FP.techField[t.id]) || 0;
  // a speculative idea belongs to the field of one of its parents (fixed by its identity)
  const fieldFor = (h, fa, fb) => ((h >>> 3) & 1 ? fa : fb);
  const EV = new Map();
  function evidence(fa, fb) {
    if (!FP || !fa || !fb) return null;
    const key = Math.min(fa, fb) + '|' + Math.max(fa, fb);
    if (EV.has(key)) return EV.get(key);
    const A = FP.subfields[fa], B = FP.subfields[fb];
    let ev = null;
    if (A && B && A.works && B.works) {
      const same = fa === fb, pr = FP.pairs[key] || [0, 0];
      const n = same ? A.works : pr[0], hits = same ? A.hits : pr[1];
      const expected = same ? A.works : A.works * B.works / FP.total;
      const hr0 = FP.totalHits / FP.total, m = 200;   // shrink small samples towards the average hit rate
      ev = { a: A.name, b: B.name, same, n, hits,
        rel: same ? 1.5 : Math.log10((n + 1) / (expected + 1)),   // >0: combined more often than chance
        lift: ((hits + m * hr0) / (n + m)) / hr0 };                  // >1: pays off more often than average
    }
    EV.set(key, ev);
    return ev;
  }
  const realValue = t => Math.min(2.5, Math.max(0.03, 0.02 * Math.pow(t.sitelinks / 10, 1.2)));

  function techProps(us, h, depth, fa, fb) {
    const real = REAL.byHash.get(h);
    if (real) return { v: realValue(real), d: Math.min(0.95, 0.12 + 0.3 * rnd(us, h, 3, 0) + 0.045 * depth), real };
    // speculative value: heavy-tailed estimate, capped below the most important real inventions.
    // Field evidence shifts it: related fields yield something useful more often; fields whose
    // combinations get cited more pay more; atypical pairings (rarer than chance) have a longer tail.
    const ev = evidence(fa, fb);
    const pUseful = ev ? 0.45 * Math.min(1.4, Math.max(0.3, 0.75 + 0.3 * Math.tanh(ev.rel))) : 0.45;
    const novelty = ev && ev.rel < 0 ? Math.min(1, -ev.rel) : 0;
    const scale = ev ? 0.012 * Math.pow(ev.lift, 0.8) * (1 + 0.8 * novelty) : 0.012;
    const dud = rnd(us, h, 1, 0) >= pUseful;
    const v = dud ? 0 : Math.min(0.8, scale * Math.pow(1 - rnd(us, h, 2, 0) * 0.999, -1 / 1.25) * (1 + 0.08 * depth));
    const d = Math.min(0.95, 0.12 + 0.55 * rnd(us, h, 3, 0) + 0.045 * depth);
    return { v, d };
  }
  // real technologies keep their names; speculative ones are named after what they combine
  function nameFor(h, na, nb) {
    const real = REAL.byHash.get(h);
    if (real) return real.name;
    if (na && nb && na.length + nb.length <= 34 && !/×|Hybrid/.test(na + nb)) return `${na} × ${nb}`;
    const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    return 'Hybrid ' + L[h % 24] + L[(h >>> 5) % 24] + L[(h >>> 10) % 24] + '-' + ((h >>> 15) % 9 + 1);
  }
  function personName(seed, c, idx) {
    const h = hash4(seed, c, idx, 0x77), n = SYL.length;
    const first = cap1(SYL[h % n] + SYL[(h >>> 5) % n]);
    const last = cap1(SYL[(h >>> 10) % n] + SYL[(h >>> 15) % n] + ((h >>> 20) & 1 ? SYL[(h >>> 21) % n] : ''));
    return first + ' ' + last;
  }
  function regionName(us, c) {
    const x = c % W, y = (c / W) | 0, h = hash4(us, x >> 3, y >> 2, 0x99), n = SYL.length;
    return cap1(SYL[h % n] + SYL[(h >>> 6) % n] + SYL[(h >>> 12) % n]);
  }

  // ---------- universe: geography + starting conditions ----------
  function vnoise(us, salt, x, y, sc) {
    const xs = x / sc, ys = y / sc, x0 = Math.floor(xs), y0 = Math.floor(ys);
    const fx = xs - x0, fy = ys - y0, s = t => t * t * (3 - 2 * t);
    const g = (i, j) => rnd(us, i, j, salt * 131 + sc);
    const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
    const u = s(fx), v = s(fy);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const fbm = (us, salt, x, y) => 0.55 * vnoise(us, salt, x, y, 12) + 0.3 * vnoise(us, salt + 1, x, y, 6) + 0.15 * vnoise(us, salt + 2, x, y, 3);

  const U_CACHE = new Map();
  function makeUniverse(us) {
    us >>>= 0;
    if (U_CACHE.has(us)) return U_CACHE.get(us);
    const elev = new Float32Array(C);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = (x - (W - 1) / 2) / (W / 2), dy = (y - (H - 1) / 2) / (H / 2);
      elev[y * W + x] = fbm(us, 10, x, y) - 0.35 * (dx * dx + dy * dy);
    }
    const thr = Array.from(elev).sort((a, b) => a - b)[Math.floor(C * 0.58)];
    const land = new Uint8Array(C);
    for (let c = 0; c < C; c++) land[c] = elev[c] > thr ? 1 : 0;
    const landIdx = [];
    for (let c = 0; c < C; c++) if (land[c]) landIdx.push(c);
    const nbOff = new Int32Array(landIdx.length + 1), nbList = [], coastal = new Uint8Array(C);
    landIdx.forEach((c, li) => {
      nbOff[li] = nbList.length;
      const x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) { coastal[c] = 1; continue; }
        const n = ny * W + nx;
        if (land[n]) nbList.push(n); else coastal[c] = 1;
      }
    });
    nbOff[landIdx.length] = nbList.length;

    const init = { pop: new Float32Array(C), edu: new Float32Array(C), skill: new Float32Array(C), risk: new Float32Array(C),
      creat: new Float32Array(C), conn: new Float32Array(C), cap: new Float32Array(C) };
    const inst = new Float32Array(C), baseExp = new Float32Array(NB * C);
    let popSum = 0;
    for (const c of landIdx) {
      const x = c % W, y = (c / W) | 0, f = k => fbm(us, 100 + k * 7, x, y);
      inst[c] = clamp01(0.2 + 1.2 * (f(1) - 0.35));
      init.pop[c] = Math.exp(3 * (f(2) - 0.5)) * (coastal[c] ? 1.3 : 1);
      popSum += init.pop[c];
      init.edu[c] = clamp01(0.04 + 0.5 * (f(3) - 0.3));
      init.skill[c] = clamp01(0.25 + 0.5 * (f(4) - 0.3));
      init.risk[c] = clamp01(0.25 + 0.6 * (f(5) - 0.3));
      init.creat[c] = clamp01(0.3 + 0.5 * (f(6) - 0.3));
      init.conn[c] = clamp01(0.1 + 0.18 * coastal[c] + 0.3 * (f(7) - 0.3));
      init.cap[c] = clamp01(0.03 + 0.3 * inst[c] + 0.2 * (f(8) - 0.3));
      for (let k = 0; k < NB; k++) {
        // older knowledge has spread further by 1900
        const v = fbm(us, 300 + k * 5, x, y), yr = REAL.axioms[k].year;
        const bias = yr < 1700 ? 0.45 : yr < 1850 ? 0.12 : 0.05;
        baseExp[k * C + c] = clamp01((v - 0.5) * 3 + bias);
      }
    }
    for (const c of landIdx) init.pop[c] *= 1.6e9 / popSum;   // ~1900 world population
    const U = { us, land, landIdx, nbOff, nbList, coastal, inst, init, baseExp };
    U_CACHE.set(us, U);
    return U;
  }

  // ---------- world ----------
  function normalizeIv(iv, n) {
    return { type: iv.type, year: iv.year | 0, cx: iv.cx | 0, cy: iv.cy | 0, radius: iv.radius == null ? 3 : +iv.radius,
      mag: iv.mag == null ? 1 : +iv.mag, tech: iv.tech >>> 0, techName: iv.techName || '', n,
      ah: iv.ah >>> 0, bh: iv.bh >>> 0, cell: iv.cell == null ? -1 : iv.cell | 0 };
  }
  function ivLabel(iv) {
    const where = iv.radius >= 99 ? 'worldwide' : `around (${iv.cx},${iv.cy}) r${iv.radius}`;
    switch (iv.type) {
      case 'education': return `Education boost ×${iv.mag} ${where} from ${iv.year}`;
      case 'capital': return `Capital access ×${iv.mag} ${where} from ${iv.year}`;
      case 'connect': return `Connectivity ×${iv.mag} ${where} from ${iv.year}`;
      case 'shock': return `War / disaster ×${iv.mag} ${where} in ${iv.year}`;
      case 'boost': return `${iv.techName} made ${(1 + 2 * iv.mag).toFixed(1)}× more valuable from ${iv.year}`;
      case 'block': return `${iv.techName} can never be invented`;
      case 'seed': return `${iv.techName} brought into existence in ${iv.year}`;
    }
    return iv.type;
  }
  function regionCells(U, iv) {
    const out = [];
    for (const c of U.landIdx) {
      const dx = (c % W) - iv.cx, dy = ((c / W) | 0) - iv.cy;
      if (iv.radius >= 99 || dx * dx + dy * dy <= iv.radius * iv.radius) out.push(c);
    }
    return out;
  }

  // opts.branch = { t, seed }: from tick t onward chance comes from another seed, so many futures
  // can share one identical past.
  function World(U, seed, interventions, opts) {
    this.U = U; this.seed = seed >>> 0; this.t = 0; this.cur = this.seed;
    this.branch = opts && opts.branch ? { t: opts.branch.t | 0, seed: opts.branch.seed >>> 0 } : null;
    this.iv = (interventions || []).map(normalizeIv);
    const I = U.init;
    this.pop = Float32Array.from(I.pop); this.edu = Float32Array.from(I.edu); this.skill = Float32Array.from(I.skill);
    this.risk = Float32Array.from(I.risk); this.creat = Float32Array.from(I.creat); this.conn = Float32Array.from(I.conn);
    this.cap = Float32Array.from(I.cap);
    this.wealth = new Float32Array(C); this.prod = new Float32Array(C); this.techSum = new Float32Array(C);
    this.femp = new Float32Array(C); this.eduB = new Float32Array(C); this.capB = new Float32Array(C);
    this.connB = new Float32Array(C); this.ivMask = new Uint8Array(C);
    this.lostCap = new Float32Array(C); this.lostRes = new Float32Array(C);   // value of ideas that died here, by bottleneck
    this.exp = new Float32Array(MAXT * C); this.exp2 = new Float32Array(MAXT * C);
    this.exp.set(U.baseExp);
    this.T = { n: 0, hash: [], a: [], b: [], v: [], d: [], depth: [], year: [], cell: [], name: [], inv: [], meta: [], real: [], field: [],
      children: [], adopt: new Float32Array(MAXT) };
    this.tIndex = new Map(); this.names = new Set(); this.boost = new Map();
    for (let k = 0; k < NB; k++) this.addTech(REAL.axioms[k].h, -1, -1, -1, { v: 0.08, d: 0, real: REAL.axioms[k] }, null);
    this.people = []; this.pidMap = new Map(); this.firms = []; this.firmTech = new Set();
    this.ideas = new Map(); this.events = []; this.hist = [];
    this.blocked = new Set(this.iv.filter(v => v.type === 'block').map(v => v.tech));
    this.counters = { attempts: 0, rediscover: 0, selfpair: 0, duds: 0, failCap: 0, failRes: 0, blocked: 0 };
    this.series = { year: [], gdp: [], pop: [], techs: [], firms: [], gini: [], people: [] };
    this.evc = 0; this.full = false;
    this.economy(true);
    this.record();
  }

  World.prototype.year = function () { return START_YEAR + this.t; };

  World.prototype.addTech = function (h, a, b, c, props, meta, forcedName) {
    const T = this.T;
    if (T.n >= MAXT) { this.full = true; return -1; }
    const k = T.n++;
    let name = forcedName || nameFor(h, a >= 0 ? T.name[a] : '', b >= 0 ? T.name[b] : '');
    if (this.names.has(name)) { let i = 2; while (this.names.has(name + ' ' + i)) i++; name = name + ' ' + i; }
    this.names.add(name);
    T.hash[k] = h; T.a[k] = a; T.b[k] = b; T.v[k] = props.v * (this.boost.get(h) || 1); T.d[k] = props.d;
    T.depth[k] = a < 0 ? 0 : Math.max(T.depth[a], T.depth[b]) + 1;
    T.year[k] = START_YEAR + this.t; T.cell[k] = c; T.name[k] = name; T.inv[k] = -1; T.meta[k] = meta; T.children[k] = [];
    T.real[k] = props.real || null;
    T.field[k] = props.real ? realField(props.real) : fieldFor(h, T.field[a], T.field[b]);
    if (a >= 0) { T.children[a].push(k); T.children[b].push(k); }
    this.tIndex.set(h, k);
    return k;
  };

  // chance a region can realise an idea: capability (ideas get harder to find as the frontier grows — Bloom et al.)
  World.prototype.capProb = function (c, d) {
    return clamp01(0.3 + 1.1 * (0.5 * this.skill[c] + 0.5 * this.edu[c]) - 0.8 * d) / (1 + this.T.n / 200);
  };
  // ... and capital: big ideas need more of it
  World.prototype.resProb = function (c, v) { return clamp01((0.15 + 0.85 * this.cap[c]) * (v > 0.3 ? 0.7 : 1)); };

  World.prototype.cellSnap = function (c) {
    let known = 0;
    for (let k = 0; k < this.T.n; k++) if (this.exp[k * C + c] > 0.03) known++;
    return { year: this.year(), edu: this.edu[c], skill: this.skill[c], cap: this.cap[c], wealth: this.wealth[c],
      conn: this.conn[c], creat: this.creat[c], risk: this.risk[c], pop: this.pop[c], known, iv: this.ivMask[c] };
  };

  World.prototype.personTraits = function (c, idx) {
    const s = this.seed, m = [this.edu[c], this.skill[c], this.creat[c], this.risk[c], this.cap[c]], out = {};
    const zw = gauss(s, c, idx, 950);
    for (let j = 0; j < 5; j++) out[TRAITS[j]] = clamp01(m[j] + 0.17 * gauss(s, c, idx, 900 + j) + (j === 4 ? 0.08 * zw : 0));
    out.wealthZ = zw; out.wealthPct = normCdf(zw);
    return out;
  };

  // Resolution increase: pick the individual most likely to have produced this event,
  // sampling candidates from the cell's distribution and weighting by propensity.
  World.prototype.materialise = function (c, role) {
    const popI = Math.max(1, Math.floor(this.pop[c])), key = this.evc++ & 0xffff;
    const cand = [], wts = []; let tot = 0;
    for (let j = 0; j < 24; j++) {
      const idx = hash4(this.cur, this.t, c, 0x40000000 + (key << 5) + j) % popI;
      const tr = this.personTraits(c, idx);
      const w = role === 'inventor'
        ? Math.pow(tr.creativity * tr.skill * (0.3 + tr.education), 2) + 1e-9
        : Math.pow(tr.risk * (0.3 + tr.capital) * (0.3 + tr.wealthPct), 2) + 1e-9;
      cand.push([idx, tr]); wts.push(w); tot += w;
    }
    let u = rnd(this.cur, this.t, c, 0x50000000 + key) * tot, pick = 0;
    while (pick < 23 && u > wts[pick]) { u -= wts[pick]; pick++; }
    const [idx, tr] = cand[pick], pid = c * 1e7 + idx;
    let p = this.pidMap.get(pid);
    if (!p) {
      const age = role === 'inventor'
        ? 21 + Math.floor(40 * Math.pow(rnd(this.seed, c, idx, 0x61), 1.4))
        : 23 + Math.floor(42 * Math.pow(rnd(this.seed, c, idx, 0x62), 1.2));
      p = { i: this.people.length, pid, cell: c, idx, name: personName(this.seed, c, idx), year: this.year(), age, traits: tr,
        roles: [], techs: [], firms: [], snap: this.cellSnap(c), cond: wts[pick] / tot, score: 0 };
      this.people.push(p); this.pidMap.set(pid, p);
    }
    if (!p.roles.includes(role)) p.roles.push(role);
    return p;
  };

  World.prototype.foundFirm = function (c, k, p, how) {
    const i = this.firms.length, s = this.cur;
    const f = { i, cell: c, tech: k, founder: p.i, born: this.year(), size: 4 + 30 * rnd(s, this.t, c, 0x60000000 + (i & 0xffff)),
      peak: 0, peakYear: this.year(), alive: true, died: 0, how,
      name: p.name.split(' ')[1] + ' ' + FIRM_SUFFIX[hash4(s, i, c, 0x63) % FIRM_SUFFIX.length] };
    f.peak = f.size;
    this.firms.push(f); p.firms.push(i); this.femp[c] += f.size; this.firmTech.add(k);
    return f;
  };

  World.prototype.log = function (type, text, ref, weight) {
    this.events.push({ year: this.year(), type, text, ref, weight });
    if (this.events.length > 600) this.events.splice(0, 100);
  };

  World.prototype.applyIntervention = function (iv) {
    const cells = regionCells(this.U, iv), m = iv.mag;
    for (const c of cells) this.ivMask[c] |= 1 << (iv.n & 7);
    switch (iv.type) {
      case 'education': for (const c of cells) { this.eduB[c] += 0.25 * m; this.edu[c] = clamp01(this.edu[c] + 0.2 * m); } break;
      case 'capital': for (const c of cells) { this.capB[c] += 0.35 * m; this.cap[c] = clamp01(this.cap[c] + 0.3 * m); } break;
      case 'connect': for (const c of cells) { this.connB[c] += 0.35 * m; this.conn[c] = clamp01(this.conn[c] + 0.3 * m); } break;
      case 'shock':
        for (const c of cells) { this.pop[c] *= 1 - 0.2 * Math.min(m, 2); this.wealth[c] *= 1 - 0.25 * Math.min(m, 2); }
        for (const f of this.firms) if (f.alive && this.ivMask[f.cell] & (1 << (iv.n & 7))) f.size *= Math.max(0.1, 1 - 0.3 * m);
        break;
      case 'seed': {
        const T = this.T, a = this.tIndex.get(iv.ah), b = this.tIndex.get(iv.bh);
        if (a === undefined || b === undefined || this.tIndex.has(iv.tech)) break;
        const c = iv.cell >= 0 && this.U.land[iv.cell] ? iv.cell : T.cell[a] >= 0 ? T.cell[a] : this.U.landIdx[0];
        const props = techProps(this.U.us, iv.tech, Math.max(T.depth[a], T.depth[b]) + 1, T.field[a], T.field[b]);
        const k = this.addTech(iv.tech, a, b, c, props, { seeded: true, capP: 1, r1: 0, resP: 1, r2: 0, ea: this.exp[a * C + c], eb: this.exp[b * C + c], priorFails: 0 });
        if (k < 0) break;
        this.exp[k * C + c] = 0.3;
        const idea = this.ideas.get(iv.tech); if (idea) idea.realised = k;
        const p = this.materialise(c, 'inventor'); T.inv[k] = p.i; p.techs.push(k);
        break;
      }
      case 'boost': {
        const mult = 1 + 2 * m; this.boost.set(iv.tech, mult);
        const k = this.tIndex.get(iv.tech); if (k !== undefined) this.T.v[k] *= mult;
        break;
      }
    }
    this.log('intervention', ivLabel(iv), { kind: 'iv', n: iv.n }, 99);
  };

  World.prototype.step = function () {
    const t = this.t;
    this.cur = this.branch && t >= this.branch.t ? this.branch.seed : this.seed;
    const U = this.U, T = this.T, s = this.cur, land = U.landIdx, nL = land.length;
    for (const iv of this.iv) if (iv.type !== 'block' && iv.year === this.year()) this.applyIntervention(iv);

    // 1. diffusion of knowledge (within-cell logistic adoption + neighbour + global leakage)
    const E = this.exp, E2 = this.exp2, nT = T.n, techSum = this.techSum, pop = this.pop, edu = this.edu, conn = this.conn;
    techSum.fill(0);
    let popTot = 0; for (const c of land) popTot += pop[c];
    for (let k = 0; k < nT; k++) {
      const off = k * C, glob = T.adopt[k], vk = T.v[k];
      let num = 0;
      for (let li = 0; li < nL; li++) {
        const c = land[li], e = E[off + c];
        let sN = 0, cnt = 0;
        for (let j = U.nbOff[li]; j < U.nbOff[li + 1]; j++) { sN += E[off + U.nbList[j]]; cnt++; }
        const m = cnt ? sN / cnt : 0;
        let g = e + 0.12 * (0.4 + edu[c]) * e * (1 - e) + (m > e ? 0.25 * conn[c] * (0.2 + edu[c]) * (m - e) : 0) + 0.02 * conn[c] * glob * (1 - e);
        if (g > 1) g = 1;
        E2[off + c] = g; techSum[c] += g * vk; num += g * pop[c];
      }
      T.adopt[k] = num / popTot;
    }
    this.exp = E2; this.exp2 = E;
    const X = this.exp;

    // 2. ideas: expected rate per cell, only the consequential draws become objects
    const ks = new Int32Array(MAXT), cum = new Float64Array(MAXT);
    for (const c of land) {
      const lam = (pop[c] / 1e6) * P.inv * this.creat[c] * (0.2 + edu[c]);
      const n = poisson(lam, rnd(s, t, c, 0x10000), rnd(s, t, c, 0x10001));
      if (n) {
        let m = 0, tot = 0;
        for (let k = 0; k < T.n; k++) { const e = X[k * C + c]; if (e > 0.03) { tot += e; ks[m] = k; cum[m++] = tot; } }
        for (let i = 0; i < n && m > 1; i++) {
          this.counters.attempts++;
          const pickK = u => { u *= tot; let lo = 0, hi = m - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < u) lo = mid + 1; else hi = mid; } return ks[lo]; };
          const a = pickK(rnd(s, t, c, 0x20000 + i));
          let b = -1;
          // related ideas get combined more often: sometimes reach for a known real partner of a
          const partners = rnd(s, t, c, 0x38000 + i) < P.related ? REAL.partners.get(T.hash[a]) : null;
          if (partners) {
            let pt = 0; const opts = [];
            for (const ph of partners) { const pk = this.tIndex.get(ph); if (pk !== undefined && X[pk * C + c] > 0.03) { opts.push(pk); pt += X[pk * C + c]; } }
            let u = rnd(s, t, c, 0x39000 + i) * pt;
            for (const pk of opts) { u -= X[pk * C + c]; if (u <= 0) { b = pk; break; } }
          }
          if (b < 0) b = pickK(rnd(s, t, c, 0x30000 + i));
          if (a === b) { this.counters.selfpair++; continue; }
          const h = pairHash(T.hash[a], T.hash[b]);
          if (this.tIndex.has(h)) { this.counters.rediscover++; continue; }
          if (this.blocked.has(h)) { this.counters.blocked++; continue; }
          const props = techProps(U.us, h, Math.max(T.depth[a], T.depth[b]) + 1, T.field[a], T.field[b]);
          if (props.v === 0) { this.counters.duds++; continue; }
          let idea = this.ideas.get(h);
          if (!idea) { idea = { h, a, b, v: props.v * (this.boost.get(h) || 1), name: nameFor(h, T.name[a], T.name[b]), conceived: 0, failCap: 0, failRes: 0, tries: [], realised: -1 }; this.ideas.set(h, idea); }
          idea.conceived++;
          const capP = this.capProb(c, props.d), r1 = rnd(s, t, c, 0x40000 + i);
          const resP = this.resProb(c, props.v), r2 = rnd(s, t, c, 0x50000 + i);
          if (r1 >= capP || r2 >= resP) {
            const reason = r1 >= capP ? 'capability' : 'capital';
            if (reason === 'capability') { idea.failCap++; this.counters.failCap++; this.lostCap[c] += idea.v; } else { idea.failRes++; this.counters.failRes++; this.lostRes[c] += idea.v; }
            if (idea.tries.length < 16) idea.tries.push({ year: this.year(), cell: c, reason });
            continue;
          }
          const meta = { capP, r1, resP, r2, ea: X[a * C + c], eb: X[b * C + c], priorFails: idea.failCap + idea.failRes };
          const k = this.addTech(h, a, b, c, props, meta);
          if (k < 0) break;
          idea.realised = k;
          X[k * C + c] = Math.max(X[k * C + c], 0.12);
          const p = this.materialise(c, 'inventor');
          T.inv[k] = p.i; p.techs.push(k);
          this.log('invention', `${T.name[k]} invented by ${p.name} in ${regionName(U.us, c)} (${T.name[a]} + ${T.name[b]})`, { kind: 'tech', k }, T.v[k]);
          const pF = clamp01(this.risk[c] * (0.25 + this.cap[c]) * (0.4 + Math.min(1, T.v[k] * 4)) * 0.8);
          if (rnd(s, t, c, 0x60000 + i) < pF) this.foundFirm(c, k, p, 'inventor');
          // refresh sampler with the new tech available
          ks[m] = k; tot += X[k * C + c]; cum[m++] = tot;
        }
      }
      // entrepreneurship on existing technology
      const lamF = (pop[c] / 1e6) * P.firm * this.risk[c] * this.cap[c];
      const nF = poisson(lamF, rnd(s, t, c, 0x70000), rnd(s, t, c, 0x70001));
      for (let i = 0; i < nF; i++) {
        let tot = 0;
        for (let k = 0; k < T.n; k++) tot += X[k * C + c] * T.v[k];
        if (tot <= 0) break;
        let u = rnd(s, t, c, 0x80000 + i) * tot, k = 0;
        for (; k < T.n - 1; k++) { u -= X[k * C + c] * T.v[k]; if (u <= 0) break; }
        const p = this.materialise(c, 'founder'), first = !this.firmTech.has(k);
        const f = this.foundFirm(c, k, p, 'market');
        if (T.v[k] > 0.25 && first) this.log('firm', `${f.name} founded by ${p.name} — first firm on ${T.name[k]}`, { kind: 'firm', i: f.i }, T.v[k] * 0.5);
      }
    }

    // 3. firms: multiplicative (Gibrat) growth driven by their technology's local adoption
    this.femp.fill(0);
    for (const f of this.firms) if (f.alive) this.femp[f.cell] += f.size;
    for (const f of this.firms) {
      if (!f.alive) continue;
      const c = f.cell, e = X[f.tech * C + c], v = T.v[f.tech];
      const crowd = 0.15 * Math.max(0, this.femp[c] / (0.25 * pop[c]) - 0.4);
      const mu = -0.035 + 0.12 * Math.tanh(3 * v * e) - crowd;
      f.size = Math.min(f.size * Math.exp(mu + 0.28 * gauss(s, t, f.i, 0x90000)), 0.2 * pop[c]);
      if (f.size > f.peak) {
        if (f.peak < 1e4 && f.size >= 1e4) this.log('firm', `${f.name} passes 10,000 employees`, { kind: 'firm', i: f.i }, 0.3);
        f.peak = f.size; f.peakYear = this.year() + 1;
      }
      if (f.size < 3 || rnd(s, t, f.i, 0xa0000) < 0.03) { f.alive = false; f.died = this.year() + 1; }
    }
    this.femp.fill(0);
    for (const f of this.firms) if (f.alive) this.femp[f.cell] += f.size;

    // 4. economy + population
    this.economy(false);
    this.t++;
    if (this.t % 5 === 0) this.hist[this.t / 5] = { edu: Float32Array.from(this.edu), wealth: Float32Array.from(this.wealth), cap: Float32Array.from(this.cap) };
    this.record();
  };

  World.prototype.economy = function (init) {
    const U = this.U, T = this.T;
    for (const c of U.landIdx) {
      const fShare = Math.min(0.35, this.femp[c] / this.pop[c]);
      const prod = (0.4 + this.edu[c]) * (1 + this.techSum[c]) * (1 + 1.5 * fShare) * (0.25 + 0.75 * U.inst[c]);
      this.prod[c] = prod;
      if (init) { this.wealth[c] = prod; continue; }
      const w = this.wealth[c] += 0.12 * (prod - this.wealth[c]);
      const lw = Math.log(1 + Math.max(0, w));
      this.edu[c] += 0.03 * (Math.min(0.97, 0.05 + 0.4 * Math.log(1 + 3 * Math.max(0, w)) * (0.4 + U.inst[c]) + this.eduB[c]) - this.edu[c]);
      this.skill[c] += 0.03 * (Math.min(0.97, 0.25 + 0.6 * this.edu[c]) - this.skill[c]);
      this.cap[c] += 0.05 * (clamp01(0.03 + 0.3 * U.inst[c] + 0.14 * lw + this.capB[c] + 0.1 * Math.min(1, fShare * 5)) - this.cap[c]);
      this.conn[c] += 0.05 * (clamp01(0.12 + 0.18 * U.coastal[c] + 0.45 * Math.tanh(T.n / 180) + this.connB[c]) - this.conn[c]);
      this.creat[c] += 0.01 * (0.35 + 0.35 * this.edu[c] - this.creat[c]);
      this.pop[c] *= 1 + 0.018 - 0.02 * this.edu[c] + 0.003 * Math.tanh(w - 1);
    }
    if (init) return;
    // migration toward more productive neighbours
    const d = new Float32Array(C);
    U.landIdx.forEach((c, li) => {
      for (let j = U.nbOff[li]; j < U.nbOff[li + 1]; j++) {
        const n = U.nbList[j], r = this.prod[n] / this.prod[c];
        if (r > 1.1) { const f = 0.004 * this.pop[c] * Math.min(1, r - 1); d[c] -= f; d[n] += f; }
      }
    });
    for (const c of U.landIdx) this.pop[c] = Math.max(1000, this.pop[c] + d[c]);
  };

  World.prototype.record = function () {
    const land = this.U.landIdx; let gdp = 0, pop = 0;
    const rows = [];
    for (const c of land) { gdp += this.pop[c] * this.prod[c]; pop += this.pop[c]; rows.push(c); }
    rows.sort((a, b) => this.prod[a] - this.prod[b]);
    // population-weighted Gini of output per head across cells
    let cumP = 0, cumY = 0, area = 0;
    for (const c of rows) {
      const p = this.pop[c] / pop, y = this.pop[c] * this.prod[c] / gdp;
      area += p * (2 * cumY + y); cumP += p; cumY += y;
    }
    const S = this.series;
    S.year.push(this.year()); S.gdp.push(gdp / 1e9); S.pop.push(pop);
    S.techs.push(this.T.n); S.firms.push(this.firms.reduce((n, f) => n + (f.alive ? 1 : 0), 0));
    S.gini.push(1 - area); S.people.push(this.people.length);
  };

  World.prototype.runTo = function (t) { t = Math.min(t, YEARS); while (this.t < t) this.step(); return this; };

  // ---------- analysis ----------
  World.prototype.impact = function () {
    const T = this.T, credit = new Float64Array(T.n);
    for (let k = T.n - 1; k >= NB; k--) {
      credit[k] += T.v[k] * T.adopt[k] * 100;
      if (T.a[k] >= NB) credit[T.a[k]] += 0.3 * credit[k];
      if (T.b[k] >= NB) credit[T.b[k]] += 0.3 * credit[k];
    }
    for (const p of this.people) {
      let sc = 0;
      for (const k of p.techs) sc += credit[k];
      for (const i of p.firms) sc += this.firms[i].peak / 5000;
      p.score = sc;
    }
    return credit;
  };

  World.prototype.descendants = function (k) {
    const seen = new Set(), st = [k];
    while (st.length) for (const ch of this.T.children[st.pop()]) if (!seen.has(ch)) { seen.add(ch); st.push(ch); }
    return seen.size;
  };

  // How closely this history's order of real inventions follows our world's (Spearman rank correlation)
  // Only the simulated past (up to the present) is comparable with our world.
  World.prototype.realCheck = function () {
    const sim = [], real = [];
    for (let k = NB; k < this.T.n; k++) if (this.T.real[k] && this.T.year[k] <= PRESENT) { sim.push(this.T.year[k]); real.push(this.T.real[k].year); }
    let within = 0;
    for (let i = 0; i < sim.length; i++) if (Math.abs(sim[i] - real[i]) <= 15) within++;
    return { found: sim.length, total: REAL.inventions, rho: spearman(sim, real), within,
      mae: sim.length ? sim.reduce((a, y, i) => a + Math.abs(y - real[i]), 0) / sim.length : NaN };
  };
  function spearman(x, y) {
    const n = x.length;
    if (n < 5) return NaN;
    const rank = arr => {
      const idx = arr.map((v, i) => i).sort((i, j) => arr[i] - arr[j]), r = new Array(n);
      for (let i = 0; i < n;) { let j = i; while (j + 1 < n && arr[idx[j + 1]] === arr[idx[i]]) j++; for (let q = i; q <= j; q++) r[idx[q]] = (i + j) / 2; i = j + 1; }
      return r;
    };
    const rx = rank(x), ry = rank(y), mx = (n - 1) / 2;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - mx); dx += (rx[i] - mx) ** 2; dy += (ry[i] - mx) ** 2; }
    return num / Math.sqrt(dx * dy);
  }

  World.prototype.zipf = function () {
    const sizes = this.firms.filter(f => f.alive).map(f => f.size).sort((a, b) => b - a).slice(0, 200);
    if (sizes.length < 20) return NaN;
    let sx = 0, sy = 0, sxx = 0, sxy = 0; const n = sizes.length;
    sizes.forEach((v, i) => { const x = Math.log(i + 1), y = Math.log(v); sx += x; sy += y; sxx += x * x; sxy += x * y; });
    return -(n * sxy - sx * sy) / (n * sxx - sx * sx);
  };

  // Biography of a materialised person. Items are tagged: 'recorded' = computed when it
  // happened; 'reconstructed' = sampled afterwards to be consistent with the recorded world.
  World.prototype.biography = function (p) {
    const U = this.U, s = this.seed, out = [], tr = p.traits, born = p.year - p.age;
    const R = (text) => out.push({ kind: 'reconstructed', text }), Rec = (text) => out.push({ kind: 'recorded', text });
    const moved = rnd(s, p.cell, p.idx, 0x71) < 0.2;
    R(`Born ${born}${moved ? ' in a neighbouring region, moved to ' : ' in '}${regionName(U.us, p.cell)} (${p.cell % W},${(p.cell / W) | 0}).`);
    const pct = Math.round(tr.wealthPct * 100);
    R(pct >= 50 ? `Family in the top ${100 - pct}% of their region by wealth.` : `Family in the bottom ${pct + 1}% of their region by wealth.`);
    const e = tr.education;
    const school = e < 0.3 ? 'little formal schooling' : e < 0.55 ? 'secondary schooling' : e < 0.8 ? 'a university education' : 'advanced research training';
    const snapT = Math.max(0, Math.min(this.hist.length - 1, Math.round((born + 12 - START_YEAR) / 5)));
    const h = this.hist[snapT];
    R(`Received ${school}${h ? ` at a time when regional education averaged ${(h.edu[p.cell] * 100).toFixed(0)}/100` : ''}.`);
    const x = p.cell % W, y = (p.cell / W) | 0;
    const peers = this.people.filter(q => q !== p && q.year <= p.year && q.year >= born + 15 &&
      Math.abs((q.cell % W) - x) <= 1 && Math.abs(((q.cell / W) | 0) - y) <= 1);
    if (peers.length) {
      const q = peers[hash4(s, p.pid, 0, 0x72) % peers.length];
      const what = q.techs.length ? `inventor of ${this.T.name[q.techs[0]]}` : q.firms.length ? `founder of ${this.firms[q.firms[0]].name}` : 'a local figure';
      R(`Plausibly crossed paths with ${q.name} (${what}, active ${q.year}).`);
    }
    const sn = p.snap;
    Rec(`When first consequential (${sn.year}): regional education ${(sn.edu * 100).toFixed(0)}, capital access ${(sn.cap * 100).toFixed(0)}, connectivity ${(sn.conn * 100).toFixed(0)}, ${sn.known} technologies known locally.`);
    Rec(`Own traits vs region: creativity ${(tr.creativity * 100).toFixed(0)} (avg ${(sn.creat * 100).toFixed(0)}), skill ${(tr.skill * 100).toFixed(0)}, risk appetite ${(tr.risk * 100).toFixed(0)} (avg ${(sn.risk * 100).toFixed(0)}), capital ${(tr.capital * 100).toFixed(0)} (avg ${(sn.cap * 100).toFixed(0)}).`);
    Rec(`Selected from 24 candidates in a population of ${Math.round(sn.pop).toLocaleString()}; carried ${(p.cond * 100).toFixed(0)}% of the propensity weight.`);
    if (sn.iv) Rec(`Their region had been altered by intervention(s): ${this.iv.filter(v => sn.iv & (1 << (v.n & 7))).map(ivLabel).join('; ')}.`);
    return out;
  };

  // ---------- the idea frontier ----------
  // Every untried combination of existing technologies, scored by direct value, the doors it would
  // open (valuable combinations of the new idea with everything that exists), and how achievable it
  // is today in the best-placed region. The landscape is fixed by the universe, so this looks ahead
  // without simulating.
  World.prototype.frontier = function (limit) {
    const T = this.T, n = T.n, us = this.U.us, X = this.exp, land = this.U.landIdx;
    const cand = [];
    let pairs = 0;
    for (let a = 1; a < n; a++) for (let b = 0; b < a; b++) {
      pairs++;
      const h = pairHash(T.hash[a], T.hash[b]);
      if (this.tIndex.has(h) || this.blocked.has(h)) continue;
      const depth = Math.max(T.depth[a], T.depth[b]) + 1, pr = techProps(us, h, depth, T.field[a], T.field[b]);
      if (pr.v > 0) cand.push({ a, b, h, depth, v: pr.v * (this.boost.get(h) || 1), d: pr.d });
    }
    const valuable = cand.length;
    cand.sort((x, y) => y.v - x.v);
    // the 400 most valuable, plus every real invention on the frontier
    const top = cand.slice(0, 400).concat(cand.slice(400).filter(f => REAL.byHash.has(f.h)));
    for (const f of top) {
      // doors: valuable ideas that become possible once this one exists
      const kids = [], ff = REAL.byHash.has(f.h) ? realField(REAL.byHash.get(f.h)) : fieldFor(f.h, T.field[f.a], T.field[f.b]);
      f.ev = evidence(T.field[f.a], T.field[f.b]);
      for (let j = 0; j < n; j++) {
        const v2 = techProps(us, pairHash(f.h, T.hash[j]), f.depth + 1, ff, T.field[j]).v;
        if (v2 > 0) kids.push(v2);
      }
      kids.sort((x, y) => y - x);
      f.doors = kids.filter(v => v >= 0.2).length;
      f.option = kids.slice(0, 5).reduce((s, v) => s + v, 0);
      f.potential = f.v + 0.5 * f.option;
      // achievability: best region where both parents are known
      let best = -1, bestP = 0, reach = 0, capAt = 0, resAt = 0, near = -1, nearE = 0;
      for (const c of land) {
        const ea = X[f.a * C + c], eb = X[f.b * C + c];
        if (ea * eb > nearE) { nearE = ea * eb; near = c; }
        if (ea <= 0.03 || eb <= 0.03) continue;
        reach++;
        const cp = this.capProb(c, f.d), rp = this.resProb(c, f.v), pp = cp * rp;
        if (pp > bestP) { bestP = pp; best = c; capAt = cp; resAt = rp; }
      }
      f.reach = reach; f.p = bestP; f.cell = best >= 0 ? best : near;
      f.bottleneck = best < 0 ? 'knowledge' : capAt < resAt ? 'capability' : 'capital';
      f.expected = f.potential * f.p;
      const idea = this.ideas.get(f.h);
      f.tried = idea ? idea.conceived : 0; f.failCap = idea ? idea.failCap : 0; f.failRes = idea ? idea.failRes : 0;
      f.name = nameFor(f.h, T.name[f.a], T.name[f.b]); f.real = REAL.byHash.get(f.h) || null;
    }
    top.sort((x, y) => y.potential - x.potential);
    return { pairs, valuable, list: top.slice(0, limit || 30), real: top.filter(f => f.real).slice(0, limit || 30),
      spec: top.filter(f => !f.real).slice(0, limit || 30) };
  };

  // Causal potential of one idea: many futures branching from the current year, each paired with
  // and without the idea brought into existence now.
  function testIdea(us, seed, ivs, idea, now, n, onProgress) {
    const U = makeUniverse(us), rows = [];
    const seedIv = { type: 'seed', year: START_YEAR + now, tech: idea.h, ah: idea.ah, bh: idea.bh, cell: idea.cell, techName: idea.name };
    for (let i = 0; i < n; i++) {
      const branch = { t: now, seed: hash4(seed, i + 1, 0xb7, 0x5eed) };
      const b = new World(U, seed, ivs, { branch }).runTo(YEARS);
      const f = new World(U, seed, ivs.concat([seedIv]), { branch }).runTo(YEARS);
      const kb = b.tIndex.get(idea.h), kf = f.tIndex.get(idea.h);
      const end = w => { const g = w.series.gdp, p = w.series.pop; return [g[g.length - 1], p[p.length - 1]]; };
      const [gb, pb] = end(b), [gf, pf] = end(f);
      rows.push({ head: (gf / pf) / (gb / pb), total: gf / gb, techs: (f.T.n - b.T.n),
        natural: kb !== undefined ? b.T.year[kb] : 0, desc: kf !== undefined ? f.descendants(kf) : 0,
        adopt: kf !== undefined ? f.T.adopt[kf] : 0 });
      if (onProgress) onProgress((i + 1) / n);
    }
    const q = (arr, p) => { const s = arr.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
    const nat = rows.filter(r => r.natural).map(r => r.natural);
    const stat = key => ({ med: q(rows.map(r => r[key]), 0.5), p10: q(rows.map(r => r[key]), 0.1), p90: q(rows.map(r => r[key]), 0.9) });
    return { n, idea, year: START_YEAR + now, head: { ...stat('head'), better: rows.filter(r => r.head > 1).length },
      total: stat('total'), techs: stat('techs'), desc: stat('desc'), adopt: stat('adopt'),
      naturally: nat.length, naturalYear: nat.length ? q(nat, 0.5) : 0 };
  }

  // ---------- ensembles ----------
  function summarise(w) {
    const techs = [];
    for (let k = NB; k < w.T.n; k++) techs.push([w.T.hash[k], w.T.year[k], w.T.name[k]]);
    return { seed: w.seed, gdp: w.series.gdp.slice(), gdpEnd: w.series.gdp[w.series.gdp.length - 1], popEnd: w.series.pop[w.series.pop.length - 1],
      gini: w.series.gini[w.series.gini.length - 1], zipf: w.zipf(), techs, nTech: w.T.n - NB, real: w.realCheck() };
  }
  function runEnsemble(us, seeds, interventions, years, onProgress) {
    const U = makeUniverse(us), base = [], fork = [];
    seeds.forEach((sd, i) => {
      base.push(summarise(new World(U, sd, []).runTo(years)));
      if (interventions.length) fork.push(summarise(new World(U, sd, interventions).runTo(years)));
      if (onProgress) onProgress((i + 1) / seeds.length);
    });
    return aggregate(base, fork);
  }
  function aggregate(base, fork) {
    const presence = new Map();
    const add = (arr, key) => arr.forEach(w => w.techs.forEach(([h, y, name]) => {
      let e = presence.get(h);
      if (!e) { e = { h, name, base: 0, fork: 0, yearsBase: [], yearsFork: [] }; presence.set(h, e); }
      e[key]++; (key === 'base' ? e.yearsBase : e.yearsFork).push(y);
    }));
    add(base, 'base'); add(fork, 'fork');
    const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
    const out = { n: base.length, forked: fork.length > 0, presence: Array.from(presence.values()),
      base: { realRho: q(base.map(w => w.real.rho).filter(isFinite), 0.5), realFound: q(base.map(w => w.real.found), 0.5), realTotal: base[0].real.total,
        realMae: q(base.map(w => w.real.mae).filter(isFinite), 0.5), gdpMed: q(base.map(w => w.gdpEnd), 0.5), gini: q(base.map(w => w.gini), 0.5), zipf: q(base.map(w => w.zipf).filter(isFinite), 0.5), nTech: q(base.map(w => w.nTech), 0.5),
        band: base[0].gdp.map((_, t) => [q(base.map(w => w.gdp[t]), 0.1), q(base.map(w => w.gdp[t]), 0.5), q(base.map(w => w.gdp[t]), 0.9)]) } };
    if (fork.length) {
      const ratios = fork.map((w, i) => w.gdpEnd / base[i].gdpEnd);
      out.fork = { gdpMed: q(fork.map(w => w.gdpEnd), 0.5), gini: q(fork.map(w => w.gini), 0.5), nTech: q(fork.map(w => w.nTech), 0.5),
        band: fork[0].gdp.map((_, t) => [q(fork.map(w => w.gdp[t]), 0.1), q(fork.map(w => w.gdp[t]), 0.5), q(fork.map(w => w.gdp[t]), 0.9)]) };
      const ph = fork.map((w, i) => (w.gdpEnd / w.popEnd) / (base[i].gdpEnd / base[i].popEnd));
      out.effect = { med: q(ratios, 0.5), p10: q(ratios, 0.1), p90: q(ratios, 0.9), better: ratios.filter(r => r > 1).length,
        head: { med: q(ph, 0.5), p10: q(ph, 0.1), p90: q(ph, 0.9), better: ph.filter(r => r > 1).length } };
    }
    return out;
  }

  const API = { W, H, C, MAXT, START_YEAR, YEARS, PRESENT, NOW_T, FUTURE, END_YEAR, rel, NB, REAL, FP, evidence, TRAITS, makeUniverse, World, runEnsemble, summarise, aggregate, testIdea, regionName, ivLabel, regionCells, hash4, rnd };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.Axiomatic = API;
})(typeof self !== 'undefined' ? self : this);
