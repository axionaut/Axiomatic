/* Axiomatic UI — map, transport, inspector, causal trace, counterfactuals, ensembles. */
(() => {
  'use strict';
  const A = window.Axiomatic;
  const { W, H, START_YEAR, YEARS, NB } = A;
  const CELL = 16;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const pct = x => (x * 100).toFixed(0);
  const fmtPop = n => n >= 1e9 ? (n / 1e9).toFixed(2) + ' bn' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' m' : n >= 1e3 ? (n / 1e3).toFixed(0) + ' k' : Math.round(n).toString();
  const signPct = r => (r >= 1 ? '+' : '−') + Math.abs((r - 1) * 100).toFixed(1) + '%';
  const xy = c => `(${c % W},${(c / W) | 0})`;

  const S = {
    us: 42, seed: 1, U: null, base: null, fork: null, ivs: [], view: 'base', layer: 'prod', playing: false,
    sel: null, tab: 'inspect', front: null, frontSort: 'potential', ideaTest: null, ideaN: 10, picking: false, draft: { cx: 24, cy: 14 }, ens: null, hover: -1,
    back: [], dirty: true, sideDirty: true, lastSide: 0, lastImpact: -1
  };
  const viewW = () => (S.view === 'fork' && S.fork ? S.fork : S.base);

  // ---------- colour ----------
  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const SEQ = ['#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec',
    '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'].map(hexRgb);
  const NEG = hexRgb('#e66767'), MID = hexRgb('#383835'), POS = hexRgb('#3987e5');
  const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = a => `rgb(${a[0]},${a[1]},${a[2]})`;
  function seq(t) {
    t = Math.max(0, Math.min(1, t)) * (SEQ.length - 1);
    const i = Math.min(SEQ.length - 2, Math.floor(t));
    return rgb(lerp(SEQ[i], SEQ[i + 1], t - i));
  }
  const divCol = t => rgb(t < 0 ? lerp(MID, NEG, Math.min(1, -t)) : lerp(MID, POS, Math.min(1, t)));
  
  // raw(): value to colour; dynamic layers stretch to this year's range so contrast survives growth
  const LAYERS = [
    { id: 'prod', name: 'Output / head', raw: (w, c) => Math.log(w.prod[c]), dyn: true, show: v => Math.exp(v).toFixed(2), v: (w, c) => w.prod[c].toFixed(2) },
    { id: 'edu', name: 'Education', raw: (w, c) => w.edu[c], lo: '0', hi: '100', v: (w, c) => pct(w.edu[c]) },
    { id: 'cap', name: 'Capital access', raw: (w, c) => w.cap[c], lo: '0', hi: '100', v: (w, c) => pct(w.cap[c]) },
    { id: 'know', name: 'Knowledge', raw: (w, c) => Math.log1p(w.techSum[c]), dyn: true, show: v => Math.expm1(v).toFixed(2), v: (w, c) => w.techSum[c].toFixed(2) },
    { id: 'conn', name: 'Connectivity', raw: (w, c) => w.conn[c], lo: '0', hi: '100', v: (w, c) => pct(w.conn[c]) },
    { id: 'pop', name: 'Population', raw: (w, c) => Math.log(w.pop[c]), dyn: true, show: v => fmtPop(Math.exp(v)), v: (w, c) => fmtPop(w.pop[c]) },
    { id: 'lost', name: 'Lost potential', raw: (w, c) => Math.log1p(w.lostCap[c] + w.lostRes[c]), dyn: true, show: v => Math.expm1(v).toFixed(1),
      v: (w, c) => `${(w.lostCap[c] + w.lostRes[c]).toFixed(1)} (skill ${w.lostCap[c].toFixed(1)} · capital ${w.lostRes[c].toFixed(1)})` },
    { id: 'firms', name: 'Enterprise', raw: (w, c) => w.femp[c] / w.pop[c], dyn: true, show: v => pct(v) + '%', v: (w, c) => pct(w.femp[c] / w.pop[c]) + '% in firms' },
    { id: 'div', name: 'Divergence', diverging: true, raw: (w, c) => Math.log(S.fork.prod[c] / S.base.prod[c]),
      v: (w, c) => signPct(S.fork.prod[c] / S.base.prod[c]) }
  ];

  // ---------- world lifecycle ----------
  function newWorld() {
    S.us = Math.max(1, +$('#us').value | 0); S.seed = Math.max(1, +$('#hs').value | 0);
    S.U = A.makeUniverse(S.us);
    S.base = new A.World(S.U, S.seed, []);
    S.fork = null; S.view = 'base'; S.sel = null; S.back = []; S.ens = null; S.playing = false;
    $('#ensOut').innerHTML = '';
    syncForkUi(); markAll();
  }
  function goTo(t) {
    t = Math.max(0, Math.min(YEARS, t | 0));
    if (t < S.base.t) {
      S.base = new A.World(S.U, S.seed, []).runTo(t);
      if (S.fork) S.fork = new A.World(S.U, S.seed, S.ivs).runTo(t);
    } else {
      S.base.runTo(t); if (S.fork) S.fork.runTo(t);
    }
    validateSel(); markAll();
  }
  function advance() {
    if (S.base.t >= YEARS) return false;
    S.base.step(); if (S.fork) S.fork.step();
    S.dirty = true;
    return true;
  }
  function validateSel() {
    const w = viewW(), s = S.sel;
    const gone = x => (x.kind === 'tech' && x.id >= w.T.n) || (x.kind === 'person' && x.id >= w.people.length) || (x.kind === 'firm' && x.id >= w.firms.length);
    S.back = S.back.filter(x => !gone(x));
    if (s && gone(s)) S.sel = null;
  }
  const markAll = () => { S.dirty = true; S.sideDirty = true; };

  // ---------- map ----------
  const canvas = $('#map'), ctx = canvas.getContext('2d');
  function drawMap() {
    const w = viewW(), L = LAYERS.find(l => l.id === S.layer) || LAYERS[0];
    ctx.fillStyle = '#121211'; ctx.fillRect(0, 0, W * CELL, H * CELL);
    const land = S.U.landIdx, vals = new Float32Array(land.length);
    let lo = 0, hi = 1;
    if (!L.diverging || S.fork) land.forEach((c, i) => { vals[i] = L.raw(w, c); });
    if (L.diverging) {
      hi = 0.01; for (const v of vals) hi = Math.max(hi, Math.abs(v));
      lo = -hi;
    } else if (L.dyn) {
      lo = Infinity; hi = -Infinity;
      for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi - lo < 1e-6) hi = lo + 1e-6;
    }
    land.forEach((c, i) => {
      const x = c % W, y = (c / W) | 0;
      ctx.fillStyle = L.diverging ? (S.fork ? divCol(vals[i] / hi) : rgb(MID)) : seq((vals[i] - lo) / (hi - lo));
      ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
    });
    const loTxt = L.dyn ? L.show(lo) : L.lo, hiTxt = L.dyn ? L.show(hi) : L.hi;
    // interventions
    ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5; ctx.strokeStyle = '#eda100';
    const circles = S.ivs.filter(v => v.type !== 'block' && v.type !== 'boost' && v.radius < 99).slice();
    if (S.picking) circles.push({ cx: S.draft.cx, cy: S.draft.cy, radius: +$('#ivRadius').value });
    for (const v of circles) {
      if (v.radius >= 99) continue;
      ctx.beginPath(); ctx.arc((v.cx + 0.5) * CELL, (v.cy + 0.5) * CELL, (v.radius + 0.5) * CELL, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]);
    // materialised people
    if ($('#showPeople').checked) {
      if (S.lastImpact !== w.t || S.lastImpactW !== w) { w.impact(); S.lastImpact = w.t; S.lastImpactW = w; }
      const top = w.people.slice().sort((a, b) => b.score - a.score).slice(0, 12);
      const topSet = new Set(top);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (const p of w.people) {
        if (topSet.has(p)) continue;
        const [px, py] = personXY(p);
        ctx.fillRect(px - 1, py - 1, 2, 2);
      }
      for (const p of top) {
        const [px, py] = personXY(p);
        ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#1a1a19'; ctx.stroke();
      }
    }
    // selection
    const sc = selCell();
    if (sc >= 0) {
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff';
      ctx.strokeRect((sc % W) * CELL - 1, ((sc / W) | 0) * CELL - 1, CELL + 1, CELL + 1);
    }
    const leg = $('#mapLegend');
    leg.innerHTML = L.diverging
      ? `Fork vs baseline, output/head: ${signPct(Math.exp(lo))} <span class="ramp" style="background:linear-gradient(90deg,${rgb(NEG)},${rgb(MID)},${rgb(POS)})"></span> ${signPct(Math.exp(hi))}`
      : `${esc(L.name)}: ${esc(loTxt)} <span class="ramp" style="background:linear-gradient(90deg,${SEQ.map(rgb).join(',')})"></span> ${esc(hiTxt)}` +
        ($('#showPeople').checked ? ` &nbsp;·&nbsp; <b style="color:#fff">●</b> materialised people` : '');
  }
  function personXY(p) {
    const h = A.hash4(p.cell, p.idx, 0x33, 1);
    return [(p.cell % W) * CELL + 2 + (h % 1000) / 1000 * (CELL - 5), ((p.cell / W) | 0) * CELL + 2 + ((h >>> 10) % 1000) / 1000 * (CELL - 5)];
  }
  function selCell() {
    const s = S.sel, w = viewW();
    if (!s) return -1;
    if (s.kind === 'cell') return s.id;
    if (s.kind === 'tech') return w.T.cell[s.id];
    if (s.kind === 'person') return w.people[s.id] ? w.people[s.id].cell : -1;
    if (s.kind === 'firm') return w.firms[s.id] ? w.firms[s.id].cell : -1;
    return -1;
  }
  function cellAt(ev) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left) / r.width * W), y = Math.floor((ev.clientY - r.top) / r.height * H);
    return x < 0 || y < 0 || x >= W || y >= H ? -1 : y * W + x;
  }
  canvas.addEventListener('mousemove', ev => {
    const c = cellAt(ev), tip = $('#tip');
    if (S.picking && c >= 0) { S.draft = { cx: c % W, cy: (c / W) | 0 }; S.dirty = true; }
    if (c < 0 || !S.U.land[c]) { tip.hidden = true; return; }
    const w = viewW(), L = LAYERS.find(l => l.id === S.layer);
    const here = w.people.filter(p => p.cell === c).length;
    tip.innerHTML = `<b>${esc(A.regionName(S.us, c))}</b> ${xy(c)}<br>${esc(L.name)}: ${L.diverging && !S.fork ? '—' : esc(L.v(w, c))}` +
      `<br>Population ${fmtPop(w.pop[c])} · output/head ${w.prod[c].toFixed(2)}` + (here ? `<br>${here} materialised ${here === 1 ? 'person' : 'people'}` : '');
    const wrap = canvas.parentElement.getBoundingClientRect();
    let left = ev.clientX - wrap.left + 14, top = ev.clientY - wrap.top + 14;
    tip.hidden = false;
    if (left + tip.offsetWidth > wrap.width - 4) left = ev.clientX - wrap.left - tip.offsetWidth - 10;
    if (top + tip.offsetHeight > wrap.height - 4) top = ev.clientY - wrap.top - tip.offsetHeight - 10;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  });
  canvas.addEventListener('mouseleave', () => { $('#tip').hidden = true; });
  canvas.addEventListener('click', ev => {
    const c = cellAt(ev);
    if (c < 0) return;
    if (S.picking) {
      S.draft = { cx: c % W, cy: (c / W) | 0 }; S.picking = false;
      $('#pickHint').hidden = true; $('#ivWhere').textContent = xy(c); markAll(); return;
    }
    if (!S.U.land[c]) return;
    // clicking a highlighted person dot selects the person
    const w = viewW(), r = canvas.getBoundingClientRect();
    const mx = (ev.clientX - r.left) / r.width * W * CELL, my = (ev.clientY - r.top) / r.height * H * CELL;
    if ($('#showPeople').checked) {
      let best = null, bd = 25;
      for (const p of w.people) {
        if (p.cell !== c) continue;
        const [px, py] = personXY(p), d = (px - mx) ** 2 + (py - my) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      if (best) return select('person', best.i);
    }
    select('cell', c);
  });

  // ---------- stats ----------
  function renderStats() {
    const w = viewW(), s = w.series, i = s.gdp.length - 1;
    const perHead = g => s.gdp[g] / s.pop[g] / (s.gdp[0] / s.pop[0]);
    let forkDelta = '';
    if (S.fork) {
      const b = S.base.series, f = S.fork.series, r = (f.gdp[i] / f.pop[i]) / (b.gdp[i] / b.pop[i]);
      forkDelta = `<div class="d">fork vs baseline: ${signPct(r)}</div>`;
    }
    const cnt = w.counters, total = s.pop[i];
    const tile = (k, v, d) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
    $('#stats').innerHTML =
      tile('Population', fmtPop(total), `${S.U.landIdx.length} cells`) +
      `<div class="stat"><div class="k">Output / head</div><div class="v">${perHead(i).toFixed(2)}×</div>${forkDelta || '<div class="d">vs 1900</div>'}</div>` +
      tile('Technologies', w.T.n - NB, `+ ${NB} axioms`) +
      tile('Firms alive', s.firms[i].toLocaleString(), `${w.firms.length.toLocaleString()} ever founded`) +
      tile('Materialised', w.people.length.toLocaleString(), `of ${fmtPop(total)} (${(w.people.length / total * 100).toExponential(0)}%)`) +
      tile('Ideas evaluated', cnt.attempts.toLocaleString(), `${(w.T.n - NB).toLocaleString()} became objects`) +
      tile('Gini (regions)', s.gini[i].toFixed(2), 'output per head');
    $('#yearLbl').textContent = w.year();
    $('#scrub').value = w.t;
    $('#play').textContent = S.playing ? '❚❚ Pause' : (S.base.t >= YEARS ? '▶ Done' : '▶ Run');
  }

  // ---------- charts ----------
  function makeChart(el, opts) {
    const ch = { el, opts, data: null };
    el.innerHTML = `<svg></svg><div class="lg"></div>`;
    const tip = document.createElement('div'); tip.className = 'ctip'; tip.hidden = true; el.parentElement.appendChild(tip);
    const svg = el.querySelector('svg');
    svg.addEventListener('mousemove', ev => {
      const d = ch.data; if (!d) return;
      const r = svg.getBoundingClientRect(), x = ev.clientX - r.left;
      const yr = Math.round(d.x.inv(x));
      const i = yr - START_YEAR;
      const rows = d.series.filter(s => s.vals[i] != null).map(s => `<i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${s.color};margin-right:5px"></i>${esc(s.name)}: <b>${opts.fmt(s.vals[i])}</b>`);
      if (d.band && d.band[i]) rows.push(`<span class="muted">ensemble 10–90%: ${opts.fmt(d.band[i][0])}–${opts.fmt(d.band[i][2])}</span>`);
      if (!rows.length) { tip.hidden = true; ch.cross.setAttribute('opacity', 0); return; }
      tip.innerHTML = `<b>${yr}</b><br>${rows.join('<br>')}`;
      tip.hidden = false;
      const fr = el.parentElement.getBoundingClientRect();
      let left = ev.clientX - fr.left + 12;
      if (left + tip.offsetWidth > fr.width) left = ev.clientX - fr.left - tip.offsetWidth - 12;
      tip.style.left = left + 'px'; tip.style.top = (ev.clientY - fr.top - 10) + 'px';
      const cx = d.x(yr);
      ch.cross.setAttribute('x1', cx); ch.cross.setAttribute('x2', cx); ch.cross.setAttribute('opacity', 1);
      ch.dots.innerHTML = d.series.filter(s => s.vals[i] != null).map(s => `<circle cx="${cx}" cy="${d.y(s.vals[i])}" r="4" fill="${s.color}" stroke="#1a1a19" stroke-width="2"/>`).join('');
    });
    svg.addEventListener('mouseleave', () => { tip.hidden = true; if (ch.cross) ch.cross.setAttribute('opacity', 0); if (ch.dots) ch.dots.innerHTML = ''; });
    ch.draw = (series, band) => {
      const wpx = svg.clientWidth || 300, hpx = 150, m = { l: 40, r: 8, t: 8, b: 20 };
      const all = series.flatMap(s => s.vals).concat(band ? band.flatMap(b => [b[0], b[2]]) : []).filter(v => v != null && isFinite(v));
      let lo = opts.log ? Math.min(...all) : 0, hi = Math.max(...all);
      if (!isFinite(hi) || hi <= lo) hi = lo + 1;
      if (opts.log) { lo = Math.max(1e-6, lo * 0.9); hi *= 1.1; }
      const tf = opts.log ? Math.log : v => v;
      const x = yr => m.l + (yr - START_YEAR) / YEARS * (wpx - m.l - m.r);
      x.inv = px => Math.max(START_YEAR, Math.min(START_YEAR + YEARS, START_YEAR + (px - m.l) / (wpx - m.l - m.r) * YEARS));
      const y = v => m.t + (1 - (tf(v) - tf(lo)) / (tf(hi) - tf(lo))) * (hpx - m.t - m.b);
      let ticks;
      if (opts.log) {
        ticks = [];
        for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const k of [1, 2, 5]) { const v = k * 10 ** e; if (v >= lo && v <= hi) ticks.push(v); }
        if (ticks.length > 5) ticks = ticks.filter((_, j) => j % 2 === 0);
      } else {
        const step = niceStep(hi / 4); ticks = []; for (let v = 0; v <= hi; v += step) ticks.push(v);
      }
      let g = '';
      for (const v of ticks) g += `<line x1="${m.l}" x2="${wpx - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="#2c2c2a"/><text x="${m.l - 6}" y="${y(v) + 3.5}" text-anchor="end" fill="#898781" font-size="10">${opts.tick(v)}</text>`;
      for (let yr = START_YEAR; yr <= START_YEAR + YEARS; yr += 40) g += `<text x="${x(yr)}" y="${hpx - 5}" text-anchor="middle" fill="#898781" font-size="10">${yr}</text>`;
      g += `<line x1="${m.l}" x2="${wpx - m.r}" y1="${hpx - m.b}" y2="${hpx - m.b}" stroke="#383835"/>`;
      if (band) {
        const up = band.map((b, i) => `${x(START_YEAR + i)},${y(b[2])}`), dn = band.map((b, i) => `${x(START_YEAR + i)},${y(b[0])}`).reverse();
        g += `<polygon points="${up.concat(dn).join(' ')}" fill="rgba(57,135,229,0.16)"/>`;
      }
      for (const s of series) {
        const pts = s.vals.map((v, i) => `${x(START_YEAR + i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
        g += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      }
      g += `<line class="cross" y1="${m.t}" y2="${hpx - m.b}" stroke="#898781" stroke-width="1" opacity="0"/><g class="dots"></g>`;
      g += `<rect x="${m.l}" y="0" width="${wpx - m.l - m.r}" height="${hpx}" fill="transparent"/>`;
      svg.setAttribute('viewBox', `0 0 ${wpx} ${hpx}`);
      svg.innerHTML = g;
      ch.cross = svg.querySelector('.cross'); ch.dots = svg.querySelector('.dots');
      ch.data = { x, y, series, band };
      const lg = el.querySelector('.lg');
      const items = series.length > 1 ? series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`) : [];
      if (band) items.push(`<span><i style="background:rgba(57,135,229,0.4);height:8px"></i>ensemble 10–90%</span>`);
      lg.innerHTML = items.join('');
    };
    return ch;
  }
  function niceStep(raw) {
    const p = 10 ** Math.floor(Math.log10(raw || 1)), n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }
  const charts = {
    gdp: makeChart($('#chGdp'), { log: true, fmt: v => v.toFixed(1), tick: v => (v >= 1 ? v.toFixed(0) : v.toFixed(1)) }),
    tech: makeChart($('#chTech'), { fmt: v => Math.round(v).toString(), tick: v => v.toFixed(0) }),
    gini: makeChart($('#chGini'), { fmt: v => v.toFixed(3), tick: v => v.toFixed(2) })
  };
  function renderCharts() {
    const mk = key => {
      const out = [{ name: 'Baseline', color: '#3987e5', vals: S.base.series[key] }];
      if (S.fork) out.push({ name: 'Fork', color: '#d95926', vals: S.fork.series[key] });
      return out;
    };
    const band = S.ens && S.ens.us === S.us && S.ens.seed === S.seed ? S.ens.res.base.band : null;
    charts.gdp.draw(mk('gdp'), band);
    charts.tech.draw(mk('techs').map(s => ({ ...s, vals: s.vals.map(v => v - NB) })));
    charts.gini.draw(mk('gini'));
  }

  // ---------- side panel ----------
  function select(kind, id) {
    if (S.sel && !(S.sel.kind === kind && S.sel.id === id)) S.back.push(S.sel);
    S.sel = { kind, id }; setTab('inspect'); markAll();
    $('#p-inspect').scrollTop = 0;
  }
  // return to the previous selection, or to the events timeline when there is none
  function goBack(all) {
    S.sel = all ? null : S.back.pop() || null;
    if (all) S.back = [];
    setTab('inspect'); markAll();
    $('#p-inspect').scrollTop = 0;
  }
  function setTab(t) {
    S.tab = t;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('.side .panel').forEach(p => { p.hidden = p.id !== 'p-' + t; });
    if (t === 'fork') fillTechOptions();
    S.sideDirty = true;
  }
  const link = (kind, id, text) => `<a class="ln" data-go="${kind}:${id}">${esc(text)}</a>`;
  const techLink = (w, k) => link('tech', k, w.T.name[k]);
  const personLink = (w, i) => link('person', i, w.people[i].name);
  const badge = kind => kind === 'recorded' ? '<span class="badge rec" title="Computed when it happened">RECORDED</span>' : '<span class="badge recon" title="Sampled afterwards to be consistent with the recorded world">RECONSTRUCTED</span>';

  function renderSide(force) {
    const now = performance.now();
    if (!force && !S.sideDirty) return;
    if (!force && S.playing && now - S.lastSide < 1200) return;
    // entity panes describe the past; don't rebuild them while time runs (keeps trees open)
    if (!force && S.playing && S.tab === 'inspect' && S.sel && S.sel.kind !== 'cell' && S.sideRendered === selKey()) return;
    S.lastSide = now; S.sideDirty = false;
    const panel = $('#p-' + S.tab), keep = panel.scrollTop;
    if (S.tab === 'inspect') { panel.innerHTML = inspectHtml(); S.sideRendered = selKey(); }
    else if (S.tab === 'people') panel.innerHTML = peopleHtml();
    else if (S.tab === 'frontier') panel.innerHTML = frontierHtml();
    else if (S.tab === 'ideas') panel.innerHTML = ideasHtml();
    else if (S.tab === 'about') panel.innerHTML = aboutHtml();
    else if (S.tab === 'fork') renderIvList();
    panel.scrollTop = keep;
  }
  const selKey = () => S.sel ? S.sel.kind + ':' + S.sel.id + ':' + S.view : '';

  function inspectHtml() {
    const w = viewW(), s = S.sel;
    if (!s) return overviewHtml(w);
    return `<div class="crumbs">${S.back.length ? '<a class="ln" data-nav="back">← Back</a> · ' : ''}<a class="ln" data-nav="home">${S.back.length ? '' : '← '}Events timeline</a></div>` + entityHtml(w, s);
  }
  function entityHtml(w, s) {
    if (s.kind === 'cell') return cellHtml(w, s.id);
    if (s.kind === 'tech') return techHtml(w, s.id);
    if (s.kind === 'person') return personHtml(w, s.id);
    if (s.kind === 'firm') return firmHtml(w, s.id);
    return '';
  }

  function overviewHtml(w) {
    const ev = w.events.filter(e => e.weight >= 0.12).slice(-60).reverse();
    return `<p class="title">${S.view === 'fork' ? 'Fork' : 'Baseline'} world · ${w.year()}</p>
      <p class="sub">Click a region, a white dot (a materialised person) or anything underlined. Everything consequential can be traced back to its causes.</p>
      <h3>Consequential events</h3>
      ${ev.length ? `<ul class="list">${ev.map(e => `<li><span class="meta">${e.year}</span> ${eventText(w, e)}</li>`).join('')}</ul>` : '<p class="muted">Nothing consequential yet. Press Run.</p>'}`;
  }
  function eventText(w, e) {
    const r = e.ref;
    if (r && r.kind === 'tech' && r.k < w.T.n) {
      const k = r.k, p = w.T.inv[k];
      return `${techLink(w, k)} invented by ${p >= 0 ? personLink(w, p) : '?'} in ${esc(A.regionName(S.us, w.T.cell[k]))} <span class="meta">(${esc(w.T.name[w.T.a[k]])} + ${esc(w.T.name[w.T.b[k]])})</span>`;
    }
    if (r && r.kind === 'firm' && r.i < w.firms.length) return esc(e.text).replace(esc(w.firms[r.i].name), link('firm', r.i, w.firms[r.i].name));
    return esc(e.text);
  }

  function distRow(label, mean, me) {
    const lo = Math.max(0, mean - 0.17), hi = Math.min(1, mean + 0.17);
    return `<span>${label}</span><div class="track"><div class="band" style="left:${lo * 100}%;width:${(hi - lo) * 100}%"></div><div class="mean" style="left:${mean * 100}%"></div>${me != null ? `<div class="me" style="left:${me * 100}%" title="this person"></div>` : ''}</div><span class="meta">${pct(mean)}</span>`;
  }

  function cellHtml(w, c) {
    const T = w.T;
    const known = [];
    for (let k = 0; k < T.n; k++) { const e = w.exp[k * A.C + c]; if (e > 0.03) known.push([k, e]); }
    known.sort((a, b) => b[1] * T.v[b[0]] - a[1] * T.v[a[0]]);
    const ppl = w.people.filter(p => p.cell === c).sort((a, b) => b.score - a.score);
    const firms = w.firms.filter(f => f.alive && f.cell === c).sort((a, b) => b.size - a.size);
    const ivs = w.iv.filter(v => w.ivMask[c] & (1 << (v.n & 7)));
    return `<p class="title">${esc(A.regionName(S.us, c))} <span class="meta">${xy(c)}</span></p>
      <p class="sub">One statistical cell standing in for ${fmtPop(w.pop[c])} people. They exist as distributions; individuals are materialised only when something consequential happens.</p>
      <div class="kv">
        <span>Output per head</span><span>${w.prod[c].toFixed(2)}</span>
        <span>Wealth per head</span><span>${w.wealth[c].toFixed(2)}</span>
        <span>Working in firms</span><span>${pct(w.femp[c] / w.pop[c])}%</span>
        <span>Technologies known</span><span>${known.length}</span>
        <span>Institutions (axiom)</span><span>${pct(S.U.inst[c])}</span>
        <span>Lost potential <span class="meta">(value of ideas that died here)</span></span><span>${(w.lostCap[c] + w.lostRes[c]).toFixed(1)} <span class="meta">skill ${w.lostCap[c].toFixed(1)} · capital ${w.lostRes[c].toFixed(1)}</span></span>
        <span>Coastal</span><span>${S.U.coastal[c] ? 'yes' : 'no'}</span>
      </div>
      ${ivs.length ? `<div class="card">Altered by: ${ivs.map(v => esc(A.ivLabel(v))).join('; ')}</div>` : ''}
      <h3>Trait distributions <span class="muted" style="text-transform:none;letter-spacing:0">(mean and typical spread)</span></h3>
      <div class="dist">
        ${distRow('Education', w.edu[c])}${distRow('Skill', w.skill[c])}${distRow('Creativity', w.creat[c])}${distRow('Risk appetite', w.risk[c])}${distRow('Capital access', w.cap[c])}${distRow('Connectivity', w.conn[c])}
      </div>
      <h3>Most valuable local knowledge</h3>
      <ul class="list">${known.slice(0, 8).map(([k, e]) => `<li>${techLink(w, k)} <span class="meta">· ${pct(e)}% adopted here · value ${T.v[k].toFixed(2)}</span></li>`).join('')}</ul>
      <h3>Materialised here (${ppl.length})</h3>
      ${ppl.length ? `<ul class="list">${ppl.slice(0, 10).map(p => `<li>${personLink(w, p.i)} <span class="meta">· ${p.roles.join(' & ')} · ${p.year}</span></li>`).join('')}</ul>` : '<p class="muted small">Nobody here has done anything consequential yet — so nobody here has been computed individually.</p>'}
      ${firms.length ? `<h3>Largest firms here</h3><ul class="list">${firms.slice(0, 6).map(f => `<li>${link('firm', f.i, f.name)} <span class="meta">· ${Math.round(f.size).toLocaleString()} employees · on ${esc(T.name[f.tech])}</span></li>`).join('')}</ul>` : ''}`;
  }

  function techHtml(w, k) {
    const T = w.T;
    const firms = w.firms.filter(f => f.tech === k);
    const aliveEmp = firms.filter(f => f.alive).reduce((s, f) => s + f.size, 0);
    if (T.a[k] < 0) {
      return `<p class="title">${esc(T.name[k])}</p><p class="sub">Axiom — present at the start of the world. Where it is known is set by the universe seed.</p>
        <div class="kv"><span>Adoption worldwide</span><span>${pct(T.adopt[k])}%</span><span>Technologies descended from it</span><span>${w.descendants(k)}</span>
        <span>Firms built on it</span><span>${firms.length}</span></div>`;
    }
    const m = T.meta[k], p = T.inv[k] >= 0 ? w.people[T.inv[k]] : null;
    const idea = w.ideas.get(T.hash[k]);
    return `<p class="title">${esc(T.name[k])}</p>
      <p class="sub">Invented ${T.year[k]} in ${link('cell', T.cell[k], A.regionName(S.us, T.cell[k]))} by ${p ? personLink(w, p.i) : '?'} — a combination of ${techLink(w, T.a[k])} + ${techLink(w, T.b[k])}.</p>
      <div class="kv">
        <span>Economic value</span><span>${T.v[k].toFixed(3)}</span>
        <span>Adoption worldwide</span><span>${pct(T.adopt[k])}%</span>
        <span>Generations from the axioms</span><span>${T.depth[k]}</span>
        <span>Technologies descended from it</span><span>${w.descendants(k)}</span>
        <span>Firms built on it</span><span>${firms.length} <span class="meta">(${Math.round(aliveEmp).toLocaleString()} employed now)</span></span>
      </div>
      <h3>Chance</h3>
      <div class="card">${m.seeded ? `${badge('recorded')} Brought into existence by your intervention — no chance involved.` : `
        ${badge('recorded')} Capability roll ${m.r1.toFixed(3)} needed &lt; ${m.capP.toFixed(3)}; capital roll ${m.r2.toFixed(3)} needed &lt; ${m.resP.toFixed(3)}.<br>
        <span class="meta">Margin: ${pct((m.capP - m.r1))} and ${pct((m.resP - m.r2))} points. ${idea && m.priorFails ? `This idea had already died ${m.priorFails}× elsewhere${idea.tries.length ? ` (first ${idea.tries[0].year}, lacking ${idea.tries[0].reason})` : ''}.` : 'First serious attempt anywhere.'}</span>`}
      </div>
      <h3>Causal ancestry</h3>
      <div class="tree">${node('tech', k, esc(T.name[k]), true)}</div>`;
  }

  function personHtml(w, i) {
    const p = w.people[i];
    if (!p) return '';
    const bio = w.biography(p), tr = p.traits, sn = p.snap;
    return `<p class="title">${esc(p.name)}</p>
      <p class="sub">${p.roles.map(r => r === 'inventor' ? 'Inventor' : 'Entrepreneur').join(' & ')} · ${link('cell', p.cell, A.regionName(S.us, p.cell))} · aged ${p.age} in ${p.year}</p>
      <p class="small muted">Before ${p.year} this person was not computed — they existed only as part of a distribution. They were materialised because a consequential event needed an originator, then sampled <em>conditioned on</em> having done it.</p>
      <h3>What they did</h3>
      <ul class="list">
        ${p.techs.map(k => `<li>Invented ${techLink(w, k)} <span class="meta">· ${w.T.year[k]} · ${w.descendants(k)} technologies descend from it</span></li>`).join('')}
        ${p.firms.map(fi => { const f = w.firms[fi]; return `<li>Founded ${link('firm', fi, f.name)} <span class="meta">· ${f.born} · peak ${Math.round(f.peak).toLocaleString()} employees${f.alive ? '' : ` · closed ${f.died}`}</span></li>`; }).join('')}
      </ul>
      <h3>Traits vs their region</h3>
      <div class="dist">
        ${distRow('Education', sn.edu, tr.education)}${distRow('Skill', sn.skill, tr.skill)}${distRow('Creativity', sn.creat, tr.creativity)}${distRow('Risk appetite', sn.risk, tr.risk)}${distRow('Capital', sn.cap, tr.capital)}
      </div>
      <p class="small muted">White marker = this person; blue = region at the time.</p>
      <h3>Path</h3>
      <ul class="list">${bio.map(b => `<li>${badge(b.kind)}${esc(b.text)}</li>`).join('')}</ul>
      ${p.techs.length ? `<h3>Causal ancestry of their work</h3><div class="tree">${p.techs.map(k => node('tech', k, esc(w.T.name[k]), false)).join('')}</div>` : ''}`;
  }

  function firmHtml(w, i) {
    const f = w.firms[i];
    return `<p class="title">${esc(f.name)}</p>
      <p class="sub">Founded ${f.born} in ${link('cell', f.cell, A.regionName(S.us, f.cell))} by ${personLink(w, f.founder)} ${f.how === 'inventor' ? '— the inventor commercialising their own idea' : '— an entrepreneur building on existing technology'}.</p>
      <div class="kv">
        <span>Technology</span><span>${techLink(w, f.tech)}</span>
        <span>Status</span><span>${f.alive ? 'operating' : 'closed ' + f.died}</span>
        <span>Employees now</span><span>${f.alive ? Math.round(f.size).toLocaleString() : '—'}</span>
        <span>Peak</span><span>${Math.round(f.peak).toLocaleString()} (${f.peakYear})</span>
      </div>
      <h3>Causal ancestry</h3>
      <div class="tree">${node('firm', i, esc(f.name), true)}</div>`;
  }

  // lazy causal tree: children rendered when a node is opened
  function node(kind, id, label, open) {
    return `<details data-k="${kind}" data-i="${id}"${open ? ' open' : ''}><summary>${label}</summary>${open ? children(kind, id) : ''}</details>`;
  }
  const leaf = (kind, text) => `<div class="leaf">${badge(kind)}${text}</div>`;
  function children(kind, id) {
    const w = viewW(), T = w.T;
    if (kind === 'tech') {
      if (id >= T.n) return '';
      if (T.a[id] < 0) return leaf('recorded', 'Axiom — present at t = 0, set by the universe seed.');
      const m = T.meta[id], p = T.inv[id], idea = w.ideas.get(T.hash[id]);
      let h = node('tech', T.a[id], `<span class="meta">combined</span> ${esc(T.name[T.a[id]])} <span class="meta">${T.a[id] < NB ? 'axiom' : T.year[T.a[id]]} · ${pct(m.ea)}% known locally</span>`)
        + node('tech', T.b[id], `<span class="meta">with</span> ${esc(T.name[T.b[id]])} <span class="meta">${T.b[id] < NB ? 'axiom' : T.year[T.b[id]]} · ${pct(m.eb)}% known locally</span>`);
      if (p >= 0) h += node('person', p, `<span class="meta">conceived by</span> ${esc(w.people[p].name)} <span class="meta">${w.T.year[id]}</span>`);
      if (idea) h += leaf('recorded', `Idea conceived ${idea.conceived}× in total; died ${idea.failCap}× for lack of capability, ${idea.failRes}× for lack of capital.`);
      h += leaf('recorded', `Chance: capability ${m.r1.toFixed(2)} &lt; ${m.capP.toFixed(2)}, capital ${m.r2.toFixed(2)} &lt; ${m.resP.toFixed(2)}.`);
      return h;
    }
    if (kind === 'person') {
      const p = w.people[id];
      if (!p) return '';
      return w.biography(p).map(b => leaf(b.kind, esc(b.text))).join('') + `<div class="leaf">${link('person', id, 'Open full profile →')}</div>`;
    }
    if (kind === 'firm') {
      const f = w.firms[id];
      return node('person', f.founder, `<span class="meta">founded by</span> ${esc(w.people[f.founder].name)}`) +
        node('tech', f.tech, `<span class="meta">built on</span> ${esc(T.name[f.tech])}`) +
        leaf('recorded', `Growth: multiplicative yearly shocks driven by local adoption of ${esc(T.name[f.tech])}; peak ${Math.round(f.peak).toLocaleString()} in ${f.peakYear}.`);
    }
    return '';
  }
  document.querySelector('.side').addEventListener('toggle', ev => {
    const d = ev.target;
    if (d.tagName !== 'DETAILS' || !d.open || d.dataset.loaded) return;
    d.dataset.loaded = '1';
    if (d.children.length <= 1) d.insertAdjacentHTML('beforeend', children(d.dataset.k, +d.dataset.i));
  }, true);
  document.querySelector('.side').addEventListener('click', ev => {
    const nav = ev.target.closest('[data-nav]');
    if (nav) { ev.preventDefault(); return goBack(nav.dataset.nav === 'home'); }
    const a = ev.target.closest('[data-go]');
    if (!a) return;
    ev.preventDefault();
    const [kind, id] = a.dataset.go.split(':');
    select(kind, +id);
  });

  // ---------- idea frontier ----------
  function frontierList() {
    const w = viewW();
    if (!S.front || S.front.w !== w || S.front.t !== w.t) S.front = { w, t: w.t, f: w.frontier(40) };
    const byExp = S.frontSort === 'expected';
    return S.front.f.list.slice().sort((a, b) => byExp ? b.expected - a.expected : b.potential - a.potential).slice(0, 25);
  }
  function frontierHtml() {
    const w = viewW(), list = frontierList(), F = S.front.f, byExp = S.frontSort === 'expected';
    const max = Math.max(...list.map(f => byExp ? f.expected : f.potential), 1e-9);
    const test = S.ideaTest;
    const lost = S.U.landIdx.map(c => [c, w.lostCap[c] + w.lostRes[c]]).sort((a, b) => b[1] - a[1]).slice(0, 6).filter(x => x[1] > 0);
    return `<p class="title">Idea frontier · ${w.year()}</p>
      <p class="sub">Every idea is a combination of what already exists. Of ${F.pairs.toLocaleString()} possible combinations of today's ${w.T.n} technologies, <b>${F.valuable.toLocaleString()}</b> would be valuable and nobody has made them yet. Ranked by <b>potential</b>: own value + half the value of the 5 best ideas it would unlock.</p>
      ${test ? testHtml(test) : ''}
      <div class="seg" style="margin:4px 0 8px"><button data-fsort="potential" class="${byExp ? '' : 'on'}">Highest potential</button><button data-fsort="expected" class="${byExp ? 'on' : ''}">Most achievable now</button></div>
      <ul class="list">${list.map((f, i) => {
        const where = f.cell >= 0 ? link('cell', f.cell, A.regionName(S.us, f.cell)) : '—';
        const why = f.bottleneck === 'knowledge' ? `no region knows both parts yet (closest: ${where})` : `best chance ${f.p < 0.001 ? '&lt;0.1' : (f.p * 100).toFixed(1)}% per try in ${where} · held back by ${f.bottleneck}`;
        return `<li><span class="meta">${i + 1}.</span> <b>${esc(f.name)}</b> <span class="meta">= ${techLink(w, f.a)} + ${techLink(w, f.b)}</span>
          <div class="bar" style="width:${Math.max(2, (byExp ? f.expected : f.potential) / max * 100)}%"></div>
          <div class="small">value ${f.v.toFixed(2)} · unlocks ${f.doors} valuable idea${f.doors === 1 ? '' : 's'} · potential ${f.potential.toFixed(2)}</div>
          <div class="meta">${why}${f.tried ? ` · tried ${f.tried}× (failed: skill ${f.failCap}, capital ${f.failRes})` : ' · never tried'}</div>
          <button class="small" data-test="${i}" ${test && test.running ? 'disabled' : ''}>Test in many worlds</button></li>`;
      }).join('')}</ul>
      <h3>Where potential is being lost</h3>
      ${lost.length ? `<ul class="list">${lost.map(([c, v]) => `<li>${link('cell', c, A.regionName(S.us, c))} <span class="meta">${xy(c)} · ${v.toFixed(1)} of value died here · mostly ${w.lostCap[c] >= w.lostRes[c] ? 'lacking skill' : 'lacking capital'}</span></li>`).join('')}</ul>
        <div class="row"><button data-layer-go="lost">Show on map</button></div>` : '<p class="muted small">Nothing lost yet.</p>'}
      <p class="small muted">The idea landscape is fixed by the universe seed, so the frontier can look ahead without simulating. "Test in many worlds" is the causal check: it branches ${S.ideaN} futures from ${w.year()} and compares each one with and without the idea.</p>`;
  }
  function testHtml(T) {
    if (T.running) return `<div class="card">Testing <b>${esc(T.idea.name)}</b> across ${S.ideaN} futures… <div class="prog"><div style="width:${(T.progress * 100).toFixed(0)}%"></div></div></div>`;
    const r = T.res, h = r.head, up = h.med >= 1;
    const verdict = r.naturally >= r.n * 0.8 ? 'it was coming anyway; the gain is mostly from having it sooner.'
      : r.naturally === 0 ? 'the world would not have found it on its own.' : 'without help it might never have arrived.';
    return `<div class="card"><b>${esc(r.idea.name)}</b> brought into existence in ${r.year} · ${r.n} paired futures
      <div class="big ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${signPct(h.med)} <span class="small muted">output per head by ${START_YEAR + YEARS}</span></div>
      10–90%: ${signPct(h.p10)} to ${signPct(h.p90)} · higher in ${h.better} of ${r.n} futures<br>
      Later ideas built on it: ${r.desc.med} <span class="meta">(${r.desc.p10}–${r.desc.p90})</span> · adoption by ${START_YEAR + YEARS}: ${pct(r.adopt.med)}%<br>
      Without help it appeared in <b>${r.naturally} of ${r.n}</b> futures${r.naturally ? ` (typically ${r.naturalYear})` : ''} — ${verdict}
      <div class="row"><button data-seed-fork>Add as intervention</button></div></div>`;
  }
  function testIdea(f) {
    const w = viewW(), ivs = S.view === 'fork' && S.fork ? S.ivs.slice() : [];
    const idea = { h: f.h, ah: w.T.hash[f.a], bh: w.T.hash[f.b], cell: f.cell, name: f.name };
    const msg = { type: 'idea', us: S.us, seed: S.seed, ivs, idea, now: w.t, n: S.ideaN };
    S.ideaTest = { running: true, progress: 0, idea };
    S.playing = false; renderSide(true);
    const done = res => { S.ideaTest = { running: false, res, idea }; renderSide(true); };
    const prog = p => {
      if (!S.ideaTest || !S.ideaTest.running) return;
      S.ideaTest.progress = p;
      const bar = document.querySelector('#p-frontier .card .prog div');
      if (bar) bar.style.width = (p * 100).toFixed(0) + '%';
    };
    const inline = () => setTimeout(() => done(A.testIdea(msg.us, msg.seed, msg.ivs, idea, msg.now, msg.n, prog)), 30);
    let wk = null;
    try { wk = new Worker('worker.js'); } catch (e) { wk = null; }
    if (!wk) return inline();
    wk.onmessage = e => { if (e.data.progress != null) prog(e.data.progress); if (e.data.result) { wk.terminate(); done(e.data.result); } };
    wk.onerror = e => { e.preventDefault(); wk.terminate(); inline(); };
    wk.postMessage(msg);
  }
  $('#p-frontier').addEventListener('click', ev => {
    const t = ev.target.closest('[data-test]'), srt = ev.target.closest('[data-fsort]'), lg = ev.target.closest('[data-layer-go]');
    if (t) testIdea(frontierList()[+t.dataset.test]);
    else if (srt) { S.frontSort = srt.dataset.fsort; renderSide(true); }
    else if (lg) { S.layer = lg.dataset.layerGo; renderLayers(); S.dirty = true; }
    else if (ev.target.closest('[data-seed-fork]') && S.ideaTest && S.ideaTest.res) {
      const r = S.ideaTest.res;
      S.ivs.push({ type: 'seed', year: r.year, tech: r.idea.h, ah: r.idea.ah, bh: r.idea.bh, cell: r.idea.cell, techName: r.idea.name, radius: 99 });
      syncForkUi(); setTab('fork');
    }
  });

  function peopleHtml() {
    const w = viewW();
    w.impact();
    const top = w.people.slice().sort((a, b) => b.score - a.score).slice(0, 30);
    const max = top.length ? top[0].score : 1, total = w.series.pop[w.series.pop.length - 1];
    return `<p class="title">The people who changed the world</p>
      <p class="sub">${w.people.length.toLocaleString()} of ${fmtPop(total)} people have been materialised — ${(w.people.length / total * 100).toExponential(1)}%. Everyone else exists only as distributions. Ranked by contribution: the value × worldwide adoption of what they invented, credit flowing back from everything built on it, plus the firms they grew.</p>
      ${top.length ? `<ul class="list">${top.map((p, r) => {
        const did = [
          ...p.techs.map(k => `${esc(w.T.name[k])} (${w.T.year[k]})`),
          ...p.firms.map(i => `${esc(w.firms[i].name)} (peak ${fmtPop(w.firms[i].peak)})`)
        ].join(', ');
        return `<li><span class="meta">${r + 1}.</span> ${personLink(w, p.i)} <span class="meta">· ${esc(A.regionName(S.us, p.cell))} · ${p.roles.join(' & ')}</span><br><span class="small">${did}</span><div class="bar" style="width:${Math.max(2, p.score / max * 100)}%"></div></li>`;
      }).join('')}</ul>` : '<p class="muted">Nobody yet. Run the world.</p>'}`;
  }

  function ideasHtml() {
    const w = viewW(), c = w.counters;
    const segs = [['Worthless combination', c.duds + c.selfpair, '#3987e5'], ['Already existed', c.rediscover, '#d95926'],
      ['Lacked capability', c.failCap, '#199e70'], ['Lacked capital', c.failRes, '#c98500']];
    const tot = segs.reduce((s, x) => s + x[1], 0) || 1;
    const unreal = Array.from(w.ideas.values()).filter(i => i.realised < 0 && i.v >= 0.04).sort((a, b) => b.v * Math.sqrt(b.conceived) - a.v * Math.sqrt(a.conceived)).slice(0, 25);
    const late = Array.from(w.ideas.values()).filter(i => i.realised >= 0 && i.realised < w.T.n && (i.failCap + i.failRes) >= 2).sort((a, b) => (b.failCap + b.failRes) * b.v - (a.failCap + a.failRes) * a.v).slice(0, 8);
    return `<p class="title">Unrealised potential</p>
      <p class="sub">Every idea is a combination of things that already exist. ${c.attempts.toLocaleString()} combinations were evaluated statistically; ${(w.T.n - NB).toLocaleString()} became technologies. Why the rest died:</p>
      <div class="stack">${segs.map(s => `<div style="width:${s[1] / tot * 100}%;background:${s[2]}" title="${s[0]}: ${s[1].toLocaleString()}"></div>`).join('')}</div>
      <div class="kv small">${segs.map(s => `<span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${s[2]};margin-right:6px"></i>${s[0]}</span><span>${s[1].toLocaleString()} · ${pct(s[1] / tot)}%</span>`).join('')}</div>
      <h3>Valuable ideas that never happened</h3>
      ${unreal.length ? `<table class="t"><tr><th>Idea</th><th class="n">Value</th><th class="n">Conceived</th><th class="n">No skill</th><th class="n">No capital</th></tr>
        ${unreal.map(i => `<tr><td>${esc(i.name)} <span class="meta">${esc(w.T.name[i.a])} + ${esc(w.T.name[i.b])}</span></td><td class="n">${i.v.toFixed(2)}</td><td class="n">${i.conceived}×</td><td class="n">${i.failCap}</td><td class="n">${i.failRes}</td></tr>`).join('')}</table>
        <p class="small muted">Try the Counterfactual tab: give capital or education to the regions where these keep dying.</p>` : '<p class="muted">None yet.</p>'}
      ${late.length ? `<h3>Ideas that died before someone succeeded</h3><ul class="list">${late.map(i => `<li>${techLink(w, i.realised)} <span class="meta">· died ${i.failCap + i.failRes}× first · realised ${w.T.year[i.realised]} by ${w.T.inv[i.realised] >= 0 ? esc(w.people[w.T.inv[i.realised]].name) : '?'}</span></li>`).join('')}</ul>` : ''}`;
  }

  function aboutHtml() {
    return `<div class="about">
      <p class="title">How Axiomatic works</p>
      <p><b>Seed thought.</b> All ideas are possibilities with different probabilities, and those probabilities come from combining a finite — but seemingly infinite — set of things.</p>
      <p><b>Cells, not agents.</b> Humanity is ${S.U.landIdx.length} statistical cells. Each holds trait <em>distributions</em> (education, skill, creativity, risk appetite, capital access, connectivity) for millions of people.</p>
      <p><b>Ideas are combinations.</b> Every invention combines two existing technologies. Only the <em>adjacent possible</em> is ever evaluated: combinations of things a region already knows. Which combinations are valuable is fixed by the universe seed, so the physics of ideas is the same in every history.</p>
      <p><b>Computation follows consequence.</b> Each cell has an expected idea rate. Only the draws that matter become objects. When one succeeds, the cell splits and the originating person is <em>materialised</em>, sampled conditioned on having done it.</p>
      <p><b>Recorded vs reconstructed.</b> Anything computed as it happened is ${badge('recorded')}: conditions, chance rolls, the ideas combined, interventions. A materialised person's earlier life is ${badge('reconstructed')}: plausible and consistent with the recorded world, but not observed.</p>
      <p><b>Determinism.</b> Every random draw is a hash of (seed, year, cell, event). Rewinding replays exactly. A fork uses the same numbers, so it differs only where your change caused a difference.</p>
      <p><b>Order in chaos.</b> Small changes can cascade, so one run proves nothing. The ensemble reruns the same universe under many chance seeds. Outcomes that appear in most worlds are <em>attractors</em>; rare ones were luck. Paired forks give an intervention's effect with a spread.</p>
      <p><b>Checks against reality.</b> Nothing below is programmed in directly; it emerges. Firm sizes should follow Zipf's law (exponent ≈ 1). Rich and poor regions should diverge. Idea productivity should fall as the frontier grows.</p>
      <p class="muted small">v0 prototype: the rules are deliberately simple and uncalibrated. It is an economic wind tunnel for the structure of causation, not a forecast.</p>
    </div>`;
  }

  // ---------- counterfactuals ----------
  function fillTechOptions() {
    const w = S.base, T = w.T, sel = $('#ivTech'), prev = sel.value;
    const ks = [];
    for (let k = 0; k < T.n; k++) ks.push(k);
    ks.sort((a, b) => T.v[b] * (0.2 + T.adopt[b]) - T.v[a] * (0.2 + T.adopt[a]));
    const type = $('#ivType').value;
    sel.innerHTML = ks.filter(k => type !== 'block' || k >= NB).slice(0, 80)
      .map(k => `<option value="${T.hash[k]}">${esc(T.name[k])} (${k < NB ? 'axiom' : T.year[k]} · v ${T.v[k].toFixed(2)})</option>`).join('');
    if (prev && sel.querySelector(`option[value="${prev}"]`)) sel.value = prev;
    else sel.selectedIndex = 0;
  }
  function syncIvForm() {
    const t = $('#ivType').value, techy = t === 'boost' || t === 'block';
    $('#ivTechRow').hidden = !techy;
    $('#ivWhereRow').hidden = techy;
    $('#ivYearRow').hidden = t === 'block';
    fillTechOptions();
  }
  function renderIvList() {
    $('#ivList').innerHTML = S.ivs.map((v, i) => `<li>${esc(A.ivLabel(v))}<button data-rm="${i}" title="Remove">✕</button></li>`).join('') ||
      '<li class="muted" style="list-style:none;margin-left:-18px">No interventions yet.</li>';
  }
  function syncForkUi() {
    $('#viewSeg').hidden = !S.fork;
    document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === S.view));
    $('#forkBtn').disabled = !S.ivs.length;
    $('#unfork').disabled = !S.fork;
    $('#forkNote').textContent = S.fork ? `Fork running alongside the baseline with ${S.fork.iv.length} intervention(s). Same chance seed — differences are caused by your changes (and what they cascade into).` : '';
    renderLayers(); renderIvList();
  }
  $('#ivType').addEventListener('change', syncIvForm);
  $('#ivMag').addEventListener('input', () => { $('#ivMagLbl').textContent = $('#ivMag').value + '×'; });
  $('#ivPick').addEventListener('click', () => { S.picking = true; $('#pickHint').hidden = false; });
  $('#ivRadius').addEventListener('change', () => { S.dirty = true; });
  $('#ivAdd').addEventListener('click', () => {
    if (S.ivs.length >= 8) return alert('Up to 8 interventions per fork.');
    const type = $('#ivType').value, opt = $('#ivTech').selectedOptions[0];
    const iv = { type, year: Math.max(START_YEAR, Math.min(START_YEAR + YEARS - 1, +$('#ivYear').value | 0)), cx: S.draft.cx, cy: S.draft.cy,
      radius: +$('#ivRadius').value, mag: +$('#ivMag').value };
    if (type === 'boost' || type === 'block') {
      if (!opt) return;
      iv.tech = +opt.value; iv.techName = opt.textContent.replace(/ \(.*$/, ''); iv.radius = 99;
    }
    S.ivs.push(iv); syncForkUi(); markAll();
  });
  $('#ivList').addEventListener('click', ev => {
    const b = ev.target.closest('[data-rm]');
    if (!b) return;
    S.ivs.splice(+b.dataset.rm, 1); syncForkUi(); markAll();
  });
  $('#forkBtn').addEventListener('click', () => {
    const t = S.base.t;
    S.fork = new A.World(S.U, S.seed, S.ivs).runTo(t);
    S.view = 'fork'; S.layer = 'div';
    if (S.sel && S.sel.kind !== 'cell') S.sel = null;
    syncForkUi(); markAll();
  });
  $('#unfork').addEventListener('click', () => {
    S.fork = null; S.view = 'base'; if (S.layer === 'div') S.layer = 'prod';
    if (S.sel && S.sel.kind !== 'cell') S.sel = null;
    syncForkUi(); markAll();
  });
  document.querySelectorAll('#viewSeg button').forEach(b => b.addEventListener('click', () => {
    if (S.view === b.dataset.view) return;
    const from = viewW();
    S.view = b.dataset.view;
    const to = viewW(), s = S.sel;
    if (s && s.kind === 'tech') { const k = to.tIndex.get(from.T.hash[s.id]); S.sel = k === undefined ? null : { kind: 'tech', id: k }; }
    else if (s && s.kind === 'person') { const p = to.pidMap.get(from.people[s.id].pid); S.sel = p ? { kind: 'person', id: p.i } : null; }
    else if (s && s.kind === 'firm') S.sel = null;
    syncForkUi(); markAll();
  }));

  // ---------- ensembles ----------
  let worker = null;
  function getWorker() {
    if (worker !== null) return worker;
    try { worker = new Worker('worker.js'); } catch (e) { worker = false; }
    return worker;
  }
  function runEnsemble() {
    const n = +$('#ensN').value, seeds = Array.from({ length: n }, (_, i) => S.seed + i);
    const ivs = S.ivs.slice(), us = S.us, seed = S.seed;
    $('#ensBtn').disabled = true; $('#ensProg').hidden = false; $('#ensProg div').style.width = '0%';
    $('#ensOut').innerHTML = `<p class="muted small">Running ${n} histories${ivs.length ? ` × 2 (baseline and fork)` : ''}…</p>`;
    const done = res => {
      S.ens = { res, us, seed, ivs };
      $('#ensBtn').disabled = false; $('#ensProg').hidden = true;
      renderEns(); S.dirty = true;
    };
    const prog = p => { $('#ensProg div').style.width = (p * 100).toFixed(0) + '%'; };
    const inline = () => {
      const U = A.makeUniverse(us), base = [], fork = [];
      let i = 0;
      (function next() {
        if (i >= seeds.length) return done(A.aggregate(base, fork));
        base.push(A.summarise(new A.World(U, seeds[i], []).runTo(YEARS)));
        if (ivs.length) fork.push(A.summarise(new A.World(U, seeds[i], ivs).runTo(YEARS)));
        prog(++i / seeds.length); setTimeout(next, 0);
      })();
    };
    const wk = getWorker();
    if (!wk) return inline();
    wk.onmessage = e => { if (e.data.progress != null) prog(e.data.progress); if (e.data.result) done(e.data.result); };
    wk.onerror = e => { e.preventDefault(); worker = false; inline(); };
    wk.postMessage({ us, seeds, ivs, years: YEARS });
  }
  $('#ensBtn').addEventListener('click', runEnsemble);

  function renderEns() {
    const E = S.ens, r = E.res, n = r.n, w = S.base;
    const pres = new Map(r.presence.map(p => [p.h, p]));
    const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
    let html = '';
    if (r.effect) {
      const e = r.effect, h = e.head, up = h.med >= 1;
      html += `<div class="card"><div class="big ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${signPct(h.med)} <span class="small muted">output per head</span></div>
        Median effect in ${START_YEAR + YEARS}, paired by chance seed. 10–90% range: ${signPct(h.p10)} to ${signPct(h.p90)}; higher in <b>${h.better} of ${n}</b> worlds.<br>
        Total world output: ${signPct(e.med)} (${signPct(e.p10)} to ${signPct(e.p90)}; higher in ${e.better} of ${n}). The two differ when the change also alters population.
        <div class="meta">${E.ivs.map(v => esc(A.ivLabel(v))).join(' · ')}</div></div>`;
    }
    html += `<div class="card"><b>Reality checks</b> <span class="meta">(emergent — not programmed)</span><div class="kv" style="margin-top:6px">
      <span>Firm-size Zipf exponent (real ≈ 1.0)</span><span>${isFinite(r.base.zipf) ? r.base.zipf.toFixed(2) : '—'}</span>
      <span>Regional Gini in ${START_YEAR + YEARS}</span><span>${r.base.gini.toFixed(2)}</span>
      <span>Technologies by ${START_YEAR + YEARS}</span><span>${r.base.nTech}</span></div></div>`;
    // contingency of this history's technologies
    const mine = [];
    for (let k = NB; k < w.T.n; k++) {
      const p = pres.get(w.T.hash[k]);
      mine.push({ k, prob: p ? p.base / n : 0, years: p ? p.yearsBase : [] });
    }
    const attract = mine.filter(m => m.prob >= 0.8).length, contingent = mine.filter(m => m.prob <= 0.25).length;
    const shown = mine.slice().sort((a, b) => w.T.v[b.k] * (0.2 + w.T.adopt[b.k]) - w.T.v[a.k] * (0.2 + w.T.adopt[a.k])).slice(0, 14);
    html += `<h3>Inevitable or lucky?</h3>
      <p class="small">Of the ${mine.length} technologies in this history (so far), <b>${attract}</b> appear in ≥80% of worlds (attractors) and <b>${contingent}</b> in ≤25% (contingent — they needed this particular luck).</p>
      <table class="t"><tr><th>Most important here</th><th>Worlds</th><th class="n">Typical year</th></tr>
      ${shown.map(m => `<tr><td>${techLink(w, m.k)}</td><td><div style="display:flex;align-items:center;gap:6px"><div class="bar" style="width:${Math.max(3, m.prob * 60)}px;margin:0"></div>${pct(m.prob)}%</div></td><td class="n">${m.years.length ? med(m.years) : '—'} <span class="meta">(here ${w.T.year[m.k]})</span></td></tr>`).join('')}</table>`;
    if (r.forked) {
      const moved = r.presence.map(p => ({ ...p, d: (p.fork - p.base) / n })).filter(p => Math.abs(p.d) >= 0.25).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 10);
      if (moved.length) html += `<h3>What the intervention made more or less likely</h3><table class="t"><tr><th>Technology</th><th class="n">Baseline</th><th class="n">Fork</th></tr>
        ${moved.map(p => `<tr><td>${esc(p.name)}</td><td class="n">${pct(p.base / n)}%</td><td class="n">${pct(p.fork / n)}% ${p.d > 0 ? '<span class="up">▲</span>' : '<span class="down">▼</span>'}</td></tr>`).join('')}</table>`;
    }
    $('#ensOut').innerHTML = html;
  }
  $('#ensOut').addEventListener('click', ev => {
    const a = ev.target.closest('[data-go]');
    if (a) { ev.preventDefault(); const [k, id] = a.dataset.go.split(':'); if (S.view !== 'base') { S.view = 'base'; syncForkUi(); } select(k, +id); }
  });

  // ---------- controls ----------
  function renderLayers() {
    $('#layers').innerHTML = LAYERS.filter(l => !l.diverging || S.fork)
      .map(l => `<button data-layer="${l.id}" class="${l.id === S.layer ? 'on' : ''}">${l.name}</button>`).join('');
  }
  $('#layers').addEventListener('click', ev => {
    const b = ev.target.closest('[data-layer]');
    if (!b) return;
    S.layer = b.dataset.layer; renderLayers(); S.dirty = true;
  });
  $('#tabs').addEventListener('click', ev => {
    const b = ev.target.closest('[data-tab]');
    if (!b) return;
    if (b.dataset.tab === 'inspect' && S.tab === 'inspect' && S.sel) return goBack(true);   // second click on Inspect = timeline
    setTab(b.dataset.tab);
  });
  $('#showPeople').addEventListener('change', () => { S.dirty = true; });
  $('#play').addEventListener('click', () => { if (S.base.t >= YEARS) return; S.playing = !S.playing; S.dirty = true; });
  $('#step').addEventListener('click', () => { S.playing = false; advance(); markAll(); });
  $('#rewind').addEventListener('click', () => { S.playing = false; goTo(0); });
  $('#scrub').addEventListener('input', () => { $('#yearLbl').textContent = START_YEAR + +$('#scrub').value; });
  $('#scrub').addEventListener('change', () => { S.playing = false; goTo(+$('#scrub').value); });
  $('#newWorld').addEventListener('click', newWorld);
  $('#reroll').addEventListener('click', () => { $('#hs').value = (+$('#hs').value | 0) + 1; newWorld(); });
  document.addEventListener('keydown', ev => {
    if (ev.target.matches('input, select, textarea')) return;
    if (ev.code === 'Space') { ev.preventDefault(); $('#play').click(); }
    if (ev.key === 'Escape' && S.picking) { S.picking = false; $('#pickHint').hidden = true; S.dirty = true; }
    else if (ev.key === 'Escape' && S.sel) goBack(false);
  });
  window.addEventListener('resize', () => { S.dirty = true; });

  // ---------- loop ----------
  let last = performance.now(), acc = 0, lastCharts = 0;
  function frame(ts) {
    const dt = Math.min(0.25, (ts - last) / 1000); last = ts;
    if (S.playing) {
      acc += dt * +$('#speed').value;
      let n = 0;
      while (acc >= 1 && n < 3) { acc -= 1; n++; if (!advance()) { S.playing = false; acc = 0; break; } }
      if (n) S.sideDirty = true;
    }
    if (S.dirty) {
      drawMap(); renderStats();
      if (!S.playing || ts - lastCharts > 250) { renderCharts(); lastCharts = ts; S.dirty = false; }
    }
    renderSide(false);
    requestAnimationFrame(frame);
  }

  newWorld();
  syncIvForm();
  requestAnimationFrame(frame);
})();
