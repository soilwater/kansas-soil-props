(() => {
  const C = Charts;
  const D = window.SOIL_DATA;

  // ---------------------------------------------------------------------------
  // Palette (dark theme; each set validated for CVD separation / ordinal steps)
  // ---------------------------------------------------------------------------
  const P = {
    single: '#3987e5',
    cat: ['#3987e5', '#d95926', '#199e70'],                               // texture groups
    depth: ['#256abf', '#3987e5', '#86b6ef', '#cde2fb'],                  // 5 -> 50 cm
    moisture: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf'],    // wet -> dry
    seq: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'],
    missing: '#52514e',
  };

  // ---------------------------------------------------------------------------
  // Data preparation
  // ---------------------------------------------------------------------------
  const DEPTHS = [5, 10, 20, 50];
  const STATES = D.states;
  const STATE = Object.fromEntries(STATES.map((s, i) => [s.id, { ...s, order: i }]));
  // Moisture classes (5 ramp steps); the common state set sat/33/70/air-dry/oven-dry stays distinct
  const MOISTURE = ['Saturated', '5–33 kPa', '70 kPa', 'Air-dry', 'Oven-dry'];
  const moistColor = r => P.moisture[MOISTURE.indexOf(r.moisture)];
  const TEX_GROUP = {
    'sand': 'Sandy', 'loamy sand': 'Sandy', 'sandy loam': 'Sandy', 'sandy clay loam': 'Sandy',
    'loam': 'Loamy', 'silt loam': 'Loamy', 'silt': 'Loamy', 'clay loam': 'Loamy', 'silty clay loam': 'Loamy',
    'sandy clay': 'Clayey', 'silty clay': 'Clayey', 'clay': 'Clayey',
  };
  const GROUPS = ['Sandy', 'Loamy', 'Clayey'];
  const GROUP_NOTE = { Sandy: 'SL, SCL', Loamy: 'L, SiL, CL, SiCL', Clayey: 'SiC, C' };

  const cores = D.cores;
  for (const c of cores) {
    c.tgroup = TEX_GROUP[c.texture] || 'Loamy';
    c.awc = c.vwc_33kPa != null && c.vwc_1500kPa != null ? c.vwc_33kPa - c.vwc_1500kPa : null;
    c.air33 = c.por != null && c.vwc_33kPa != null ? c.por - c.vwc_33kPa : null;
    c.cn = c.C != null && c.N ? c.C / c.N : null;
    c.dryHex = C.lab2hex(c.L_dry, c.a_dry, c.b_dry);
    c.wetHex = C.lab2hex(c.L_wet, c.a_wet, c.b_wet);
    c.meas = [];
  }
  const meas = D.measurements.map(m => {
    const c = cores[m.core];
    const r = { m, core: c, state: m.state, moisture: STATE[m.state].moisture, lam: m.k, cv: m.c, dif: m.d, theta: m.theta };
    c.meas.push(r);
    c[`lam_${m.state}`] = m.k; c[`cv_${m.state}`] = m.c; c[`dif_${m.state}`] = m.d;
    return r;
  });
  for (const c of cores) c.meas.sort((a, b) => STATE[a.state].order - STATE[b.state].order);
  const STATIONS = [...new Set(cores.map(c => c.station))].sort();
  const TEXTURES = [...new Set(cores.map(c => c.texture))].sort();

  // ---------------------------------------------------------------------------
  // Variables (one row per core)
  // ---------------------------------------------------------------------------
  const V = {};
  const add = (key, label, unit, group, opt = {}) => (V[key] = { key, label, unit, group, ...opt });
  add('depth', 'Depth', 'cm', 'Site');
  add('lat', 'Latitude', '°N', 'Site');
  add('lon', 'Longitude', '°E', 'Site');
  add('sand', 'Sand', '%', 'Texture & structure');
  add('silt', 'Silt', '%', 'Texture & structure');
  add('clay', 'Clay', '%', 'Texture & structure');
  add('bd', 'Bulk density', 'g cm⁻³', 'Texture & structure');
  add('pd', 'Particle density', 'g cm⁻³', 'Texture & structure');
  add('por', 'Porosity', 'cm³ cm⁻³', 'Texture & structure');
  add('air33', 'Air-filled porosity at 33 kPa', 'cm³ cm⁻³', 'Texture & structure');
  add('L_dry', 'L* dry (lightness)', '', 'Soil color (CIELAB)');
  add('a_dry', 'a* dry (red–green)', '', 'Soil color (CIELAB)');
  add('b_dry', 'b* dry (yellow–blue)', '', 'Soil color (CIELAB)');
  add('L_wet', 'L* wet (lightness)', '', 'Soil color (CIELAB)');
  add('a_wet', 'a* wet (red–green)', '', 'Soil color (CIELAB)');
  add('b_wet', 'b* wet (yellow–blue)', '', 'Soil color (CIELAB)');
  add('OM', 'Organic matter', '%', 'Chemistry');
  add('C', 'Total carbon', '%', 'Chemistry');
  add('N', 'Total nitrogen', '%', 'Chemistry');
  add('cn', 'C:N ratio', '', 'Chemistry');
  add('pH', 'pH (1:1 water)', '', 'Chemistry');
  add('pHBuf', 'Buffer pH (SMP)', '', 'Chemistry');
  add('Ca', 'Ca', 'ppm', 'Chemistry');
  add('Mg', 'Mg', 'ppm', 'Chemistry');
  add('Na', 'Na', 'ppm', 'Chemistry');
  add('Kppm', 'K', 'ppm', 'Chemistry');
  add('P', 'P (Mehlich-3)', 'ppm', 'Chemistry');
  add('vwc_field', 'θ at sampling', 'cm³ cm⁻³', 'Water retention');
  add('vwc_sat', 'θ at saturation', 'cm³ cm⁻³', 'Water retention');
  add('vwc_2kPa', 'θ at 2 kPa', 'cm³ cm⁻³', 'Water retention');
  add('vwc_5kPa', 'θ at 5 kPa', 'cm³ cm⁻³', 'Water retention');
  add('vwc_10kPa', 'θ at 10 kPa', 'cm³ cm⁻³', 'Water retention');
  add('vwc_33kPa', 'θ at 33 kPa (field capacity)', 'cm³ cm⁻³', 'Water retention');
  add('vwc_70kPa', 'θ at 70 kPa', 'cm³ cm⁻³', 'Water retention');
  add('vwc_1500kPa', 'θ at 1500 kPa (wilting point)', 'cm³ cm⁻³', 'Water retention');
  add('awc', 'Available water (33–1500 kPa)', 'cm³ cm⁻³', 'Water retention');
  const G_VG = 'van Genuchten (Rosetta)';
  add('vg_tr', 'θr residual water content', 'cm³ cm⁻³', G_VG);
  add('vg_ts', 'θs saturated water content', 'cm³ cm⁻³', G_VG);
  add('vg_alpha', 'α', 'kPa⁻¹', G_VG, { log: true });
  add('vg_n', 'n', '', G_VG);
  add('ksat', 'Saturated hydraulic conductivity', 'cm h⁻¹', 'Hydraulic conductivity', { log: true });
  const PROP = {
    lam: { sym: 'λ', label: 'Thermal conductivity', unit: 'W m⁻¹ K⁻¹' },
    cv: { sym: 'C', label: 'Volumetric heat capacity', unit: 'MJ m⁻³ K⁻¹' },
    dif: { sym: 'D', label: 'Thermal diffusivity', unit: 'mm² s⁻¹' },
  };
  for (const [p, d] of Object.entries(PROP)) for (const s of STATES) {
    add(`${p}_${s.id}`, `${d.sym} ${s.label}`, d.unit, `${d.label} ${d.sym}`);
  }
  const VARS = Object.values(V);
  const title = v => v.unit ? `${v.label} (${v.unit})` : v.label;

  // ---------------------------------------------------------------------------
  // State, filters, URL hash
  // ---------------------------------------------------------------------------
  const F = { depths: new Set(DEPTHS), station: '', texture: '' };
  const S = {
    view: 'scatter', sel: null,
    sc: { x: 'clay', y: 'vwc_1500kPa', color: 'tgroup', logX: false, logY: false, fit: true, table: false },
    hi: { v: 'bd', bins: 15, log: false, byDepth: false },
    tx: { color: 'soil_dry', labels: true },
    pu: { id: null, model: false, prop: 'lam' },
  };
  const passes = c => F.depths.has(c.depth) && (!F.station || c.station === F.station) && (!F.texture || c.texture === F.texture);
  const filtered = () => cores.filter(passes);

  function saveHash() {
    const p = new URLSearchParams({ view: S.view });
    const set = o => Object.entries(o).forEach(([k, v]) => p.set(k, v));
    if (S.view === 'scatter') set({ x: S.sc.x, y: S.sc.y, c: S.sc.color, lx: +S.sc.logX, ly: +S.sc.logY, fit: +S.sc.fit });
    if (S.view === 'hist') set({ v: S.hi.v, bins: S.hi.bins, log: +S.hi.log, bd: +S.hi.byDepth });
    if (S.view === 'texture') set({ c: S.tx.color });
    if (S.view === 'pulse') set({ core: S.pu.id, prop: S.pu.prop, model: +S.pu.model });
    else {
      if (F.depths.size < 4) p.set('depths', [...F.depths].join(','));
      if (F.station) p.set('station', F.station);
      if (F.texture) p.set('texture', F.texture);
      if (S.sel != null) p.set('sel', S.sel);
    }
    history.replaceState(null, '', '#' + p.toString());
  }
  function loadHash() {
    const p = new URLSearchParams(location.hash.slice(1)), g = k => p.get(k);
    if (['scatter', 'hist', 'texture', 'pulse'].includes(g('view'))) S.view = g('view');
    if (V[g('x')]) S.sc.x = g('x');
    if (V[g('y')]) S.sc.y = g('y');
    if (S.view === 'scatter' && g('c')) S.sc.color = g('c');
    S.sc.logX = g('lx') === '1' || (!g('lx') && !!V[S.sc.x].log);
    S.sc.logY = g('ly') === '1' || (!g('ly') && !!V[S.sc.y].log);
    if (g('fit') === '0') S.sc.fit = false;
    if (V[g('v')]) S.hi.v = g('v');
    if (+g('bins')) S.hi.bins = Math.min(40, Math.max(5, +g('bins')));
    S.hi.log = g('log') === '1'; S.hi.byDepth = g('bd') === '1';
    if (S.view === 'texture' && g('c')) S.tx.color = g('c');
    if (g('core') !== null && cores[+g('core')]) S.pu.id = +g('core');
    if (PROP[g('prop')]) S.pu.prop = g('prop');
    S.pu.model = g('model') === '1';
    if (g('depths')) { const d = g('depths').split(',').map(Number).filter(x => DEPTHS.includes(x)); if (d.length) F.depths = new Set(d); }
    if (STATIONS.includes(g('station'))) F.station = g('station');
    if (TEXTURES.includes(g('texture'))) F.texture = g('texture');
    if (g('sel') !== null && cores[+g('sel')]) S.sel = +g('sel');
  }

  // ---------------------------------------------------------------------------
  // Color encodings
  // ---------------------------------------------------------------------------
  const COLOR_MODES = { none: 'Single color', tgroup: 'Texture group', depth: 'Depth', soil_dry: 'Soil color (dry)', soil_wet: 'Soil color (wet)' };
  function colorOptions(sel) {
    sel.innerHTML = '';
    const og1 = document.createElement('optgroup'); og1.label = 'Category';
    for (const [k, label] of Object.entries(COLOR_MODES)) og1.appendChild(new Option(label, k));
    sel.appendChild(og1);
    for (const [gname, vs] of groupVars()) {
      const og = document.createElement('optgroup'); og.label = `Value · ${gname}`;
      for (const v of vs) og.appendChild(new Option(v.label, 'v:' + v.key));
      sel.appendChild(og);
    }
  }
  const legendItem = (color, text, cls = '') => `<span class="item"><span class="sw ${cls}" style="background:${color}"></span>${text}</span>`;

  // Returns { fn(core) -> hex, legend html, describe(core) -> [label, html] | null }
  function colorer(mode, rows) {
    if (mode === 'tgroup') return {
      fn: r => P.cat[GROUPS.indexOf(r.tgroup)],
      legend: GROUPS.map((g, i) => legendItem(P.cat[i], `${g} <span class="flag">${GROUP_NOTE[g]}</span>`)).join(''),
      describe: r => ['Texture', r.texture],
    };
    if (mode === 'depth') return {
      fn: r => P.depth[DEPTHS.indexOf(r.depth)],
      legend: DEPTHS.map((d, i) => legendItem(P.depth[i], `${d} cm`)).join(''),
      describe: null,
    };
    if (mode === 'soil_dry' || mode === 'soil_wet') {
      const k = mode === 'soil_dry' ? 'dryHex' : 'wetHex';
      return {
        fn: r => r[k] || P.missing,
        legend: `<span class="item">Points painted with the measured ${mode === 'soil_dry' ? 'dry' : 'wet'} soil color</span>`,
        describe: r => ['Soil color', r[k] ? `<span class="tile" style="background:${r[k]}"></span>${r[k]}` : '–'],
      };
    }
    if (mode && mode.startsWith('v:') && V[mode.slice(2)]) {
      const v = V[mode.slice(2)];
      const vals = rows.map(r => r[v.key]).filter(x => x != null);
      const log = v.log && vals.every(x => x > 0);
      const [lo, hi] = vals.length ? [Math.min(...vals), Math.max(...vals)] : [0, 1];
      const t = x => log ? (Math.log10(x) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo) || 1) : (x - lo) / (hi - lo || 1);
      return {
        fn: r => r[v.key] == null ? P.missing : C.ramp(P.seq, t(r[v.key])),
        legend: `<span class="item">${title(v)}</span><span class="item">${C.fmt(lo)} <span class="ramp" style="background:linear-gradient(90deg, ${P.seq.join(',')})"></span> ${C.fmt(hi)}</span>`
          + legendItem(P.missing, 'no data'),
        describe: r => [v.label, `${C.fmt(r[v.key])} ${v.unit}`],
      };
    }
    return { fn: () => P.single, legend: '', describe: null };
  }

  // ---------------------------------------------------------------------------
  // Shared UI helpers
  // ---------------------------------------------------------------------------
  const $ = id => document.getElementById(id);
  function groupVars() {
    const groups = new Map();
    for (const v of VARS) { if (!groups.has(v.group)) groups.set(v.group, []); groups.get(v.group).push(v); }
    return groups;
  }
  function fillVarSelect(sel, value) {
    sel.innerHTML = '';
    for (const [gname, vs] of groupVars()) {
      const og = document.createElement('optgroup'); og.label = gname;
      for (const v of vs) og.appendChild(new Option(title(v), v.key));
      sel.appendChild(og);
    }
    sel.value = value;
  }
  function segment(root, value, onChange) {
    const btns = [...root.querySelectorAll('button')];
    const set = v => btns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    set(value);
    btns.forEach(b => b.addEventListener('click', () => { set(b.dataset.v); onChange(b.dataset.v); }));
    return set;
  }
  const rowName = r => `${r.station} · ${r.depth} cm · core ${r.core}`;
  const tipRow = (k, v) => `<div class="r"><span>${k}</span><span>${v}</span></div>`;
  const valUnit = (v, x) => `${C.fmt(x)}${v.unit ? ' ' + v.unit : ''}`;
  const isMobile = () => window.innerWidth < 600;

  function downloadCsv(name, header, rows) {
    const esc = v => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([[header, ...rows].map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv' }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Hover ring + tooltip + click for a point layer
  function hoverPoints(f, pts, tipHtml, onClick) {
    const hover = C.el('circle', { class: 'hover-ring', r: 7.5, visibility: 'hidden' }, f.g);
    C.pointer(f.svg, f.g, f.m, pts, {
      onHover: (p, ev) => {
        if (!p) { hover.setAttribute('visibility', 'hidden'); C.hideTip(); return; }
        hover.setAttribute('cx', p.px); hover.setAttribute('cy', p.py); hover.setAttribute('visibility', 'visible');
        C.showTip(tipHtml(p), ev.clientX, ev.clientY);
      },
      onClick,
    });
  }

  // ---------------------------------------------------------------------------
  // Filters
  // ---------------------------------------------------------------------------
  function initFilters() {
    const chips = $('depthChips');
    chips.innerHTML = DEPTHS.map(d => `<button class="chip" data-d="${d}">${d} cm</button>`).join('');
    chips.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
      const d = +b.dataset.d;
      if (F.depths.has(d)) { if (F.depths.size > 1) F.depths.delete(d); } else F.depths.add(d);
      render();
    }));
    $('fStation').innerHTML = '<option value="">All stations</option>' + STATIONS.map(s => `<option>${s}</option>`).join('');
    $('fTexture').innerHTML = '<option value="">All textures</option>' + TEXTURES.map(t => `<option>${t}</option>`).join('');
    $('fStation').addEventListener('change', e => { F.station = e.target.value; render(); });
    $('fTexture').addEventListener('change', e => { F.texture = e.target.value; render(); });
    $('resetFilters').addEventListener('click', () => { F.depths = new Set(DEPTHS); F.station = ''; F.texture = ''; render(); });
  }
  function syncFilters() {
    document.querySelectorAll('#depthChips .chip').forEach(b => b.setAttribute('aria-pressed', String(F.depths.has(+b.dataset.d))));
    $('fStation').value = F.station; $('fTexture').value = F.texture;
    const n = filtered().length;
    $('filterCount').textContent = n === cores.length ? `${n} cores` : `${n} of ${cores.length} cores`;
  }

  // ---------------------------------------------------------------------------
  // Detail panel (selected core)
  // ---------------------------------------------------------------------------
  function select(id) { S.sel = id; render(); }

  function renderDetail(host) {
    const c = cores[S.sel];
    if (!c) { host.innerHTML = '<p class="empty">Click a point to inspect that core: soil color, texture, key properties, its water retention curve and its heat-pulse measurements.</p>'; return; }
    const kv = (label, v, unit, d) => `<dt>${label}</dt><dd>${v == null ? '–' : C.fmt(v, d)}${unit && v != null ? `<span class="u">${unit}</span>` : ''}</dd>`;
    const tile = (hex, name, L, a, b) => `<div class="swatch"><div class="tile" style="background:${hex || 'transparent'}"></div><div class="cap">${name} · L* ${C.fmt(L, 1)} a* ${C.fmt(a, 1)} b* ${C.fmt(b, 1)}</div></div>`;
    const thermRows = c.meas.map(r => `<tr><td class="l"><span class="sw" style="background:${moistColor(r)}"></span>${STATE[r.state].label}</td><td>${C.fmt(r.theta, 3)}</td><td>${C.fmt(r.lam, 2)}</td><td>${C.fmt(r.cv, 2)}</td></tr>`).join('');
    host.innerHTML = `
      <h2>${c.station}</h2>
      <div class="meta">${c.county} County · ${c.depth} cm (${c.top}–${c.bottom} cm) · core ${c.core} · sampled ${c.date || '–'}</div>
      <div class="swatches">${tile(c.dryHex, 'Dry', c.L_dry, c.a_dry, c.b_dry)}${tile(c.wetHex, 'Wet', c.L_wet, c.a_wet, c.b_wet)}</div>
      <h3>Texture &amp; structure</h3>
      <dl class="kv">
        <dt>Class</dt><dd>${c.texture}</dd>
        <dt>Sand / silt / clay</dt><dd>${C.fmt(c.sand, 0)} / ${C.fmt(c.silt, 0)} / ${C.fmt(c.clay, 0)}<span class="u">%</span></dd>
        ${kv('Bulk density', c.bd, 'g cm⁻³', 2)}${kv('Porosity', c.por, 'cm³ cm⁻³', 3)}
        ${kv('Organic matter', c.OM, '%', 1)}${kv('pH', c.pH, '', 1)}
        ${kv('Ksat', c.ksat, 'cm h⁻¹')}${kv('Available water', c.awc, 'cm³ cm⁻³', 3)}
      </dl>
      <h3>Water retention</h3>
      <div class="mini"></div>
      ${c.meas.length ? `<h3>Thermal properties</h3>
      <table><thead><tr><th class="l">State</th><th>θ</th><th>λ</th><th>C</th></tr></thead><tbody>${thermRows}</tbody></table>
      <button class="go">View heat-pulse curves →</button>` : ''}`;
    const go = host.querySelector('.go');
    if (go) go.addEventListener('click', () => { S.pu.id = c.id; switchView('pulse'); });
    miniRetention(host.querySelector('.mini'), c);
  }

  // van Genuchten (1980), Mualem constraint m = 1 - 1/n; h in kPa. Parameters from Rosetta
  // (one set per station and depth, shared by both cores), α converted to kPa⁻¹ in build_data.py
  const vanGenuchten = (c, h) => c.vg_tr + (c.vg_ts - c.vg_tr) / Math.pow(1 + Math.pow(c.vg_alpha * h, c.vg_n), 1 - 1 / c.vg_n);

  function miniRetention(node, c) {
    const pts = [2, 5, 10, 33, 70, 1500].map(k => ({ psi: k, th: c[`vwc_${k}kPa`] })).filter(p => p.th != null);
    if (!pts.length) { node.innerHTML = '<p class="empty">No retention data.</p>'; return; }
    const f = C.frame(node, 180, { top: 10, right: 10, bottom: 44, left: 56 });
    const x = C.scale([1, 2000], [0, f.w], true);
    const y = C.scale([0, 0.6], [f.h, 0]);
    C.axes(f.g, x, y, f.w, f.h, 'Matric potential (kPa)', null);
    C.el('text', { class: 'axis-title', transform: `translate(${-40},${f.h / 2}) rotate(-90)`, 'text-anchor': 'middle', text: 'θ (cm³ cm⁻³)' }, f.g);
    const hasFit = c.vg_n != null;
    if (hasFit) {
      const hs = Array.from({ length: 81 }, (_, i) => Math.pow(10, Math.log10(2000) * i / 80));
      C.el('path', { d: 'M' + hs.map(h => `${x(h).toFixed(1)},${y(vanGenuchten(c, h)).toFixed(1)}`).join('L'), class: 'curve', stroke: P.single }, f.g);
    }
    for (const p of pts) C.el('circle', { cx: x(p.psi), cy: y(p.th), r: 4, class: 'pt', fill: hasFit ? '#cde2fb' : P.single }, f.g);
    const cap = document.createElement('div');
    cap.className = 'mini-cap';
    // Agreement between the Rosetta curve and this core's measured points
    const rmse = hasFit ? Math.sqrt(C.mean(pts.map(p => (vanGenuchten(c, p.psi) - p.th) ** 2))) : null;
    const inputs = c.vg_model === 2 ? 'texture and BD' : 'texture, BD, θ33 and θ1500';
    cap.innerHTML = hasFit
      ? `<span class="flag">● measured, this core · — van Genuchten, Rosetta (${inputs})</span><br>`
        + `θr ${C.fmt(c.vg_tr, 3)} · θs ${C.fmt(c.vg_ts, 3)} · α ${C.fmt(c.vg_alpha, 3)} kPa⁻¹ · n ${C.fmt(c.vg_n, 2)} · RMSE ${C.fmt(rmse, 3)}`
      : '<span class="flag">No van Genuchten parameters for this core</span>';
    node.appendChild(cap);
  }

  // ---------------------------------------------------------------------------
  // Scatter
  // ---------------------------------------------------------------------------
  function initScatter() {
    const st = S.sc;
    fillVarSelect($('sX'), st.x); fillVarSelect($('sY'), st.y);
    colorOptions($('sColor'));
    if (![...$('sColor').options].some(o => o.value === st.color)) st.color = 'tgroup';
    $('sX').addEventListener('change', e => { st.x = e.target.value; st.logX = !!V[st.x].log; render(); });
    $('sY').addEventListener('change', e => { st.y = e.target.value; st.logY = !!V[st.y].log; render(); });
    $('sSwap').addEventListener('click', () => { [st.x, st.y, st.logX, st.logY] = [st.y, st.x, st.logY, st.logX]; render(); });
    $('sColor').addEventListener('change', e => { st.color = e.target.value; render(); });
    $('sLogX').addEventListener('change', e => { st.logX = e.target.checked; render(); });
    $('sLogY').addEventListener('change', e => { st.logY = e.target.checked; render(); });
    $('sFit').addEventListener('change', e => { st.fit = e.target.checked; render(); });
    $('sTableBtn').addEventListener('click', () => { st.table = !st.table; render(); });
    $('sCsv').addEventListener('click', () => {
      const { pts } = scatterPoints();
      downloadCsv(`kansas_soils_${st.x}_vs_${st.y}.csv`, ['station', 'county', 'depth_cm', 'core', 'texture', st.x, st.y],
        pts.map(p => [p.r.station, p.r.county, p.r.depth, p.r.core, p.r.texture, p.x, p.y]));
    });
  }

  function scatterPoints() {
    const st = S.sc, pts = [];
    let missing = 0, nonpos = 0;
    for (const r of filtered()) {
      const x = r[st.x], y = r[st.y];
      if (x == null || y == null) { missing++; continue; }
      if ((st.logX && x <= 0) || (st.logY && y <= 0)) { nonpos++; continue; }
      pts.push({ r, x, y });
    }
    return { pts, missing, nonpos };
  }

  function renderScatter() {
    const st = S.sc, vx = V[st.x], vy = V[st.y];
    $('sX').value = st.x; $('sY').value = st.y; $('sColor').value = st.color;
    $('sLogX').checked = st.logX; $('sLogY').checked = st.logY; $('sFit').checked = st.fit;
    const { pts, missing, nonpos } = scatterPoints();
    const col = colorer(st.color, pts.map(p => p.r));
    $('sLegend').innerHTML = col.legend;

    const f = C.squareFrame($('sChart'), { left: 62, right: 16, top: 12, bottom: 46 }, isMobile() ? 320 : 600);
    const x = C.scale(C.extent(pts.map(p => p.x), st.logX), [0, f.w], st.logX);
    const y = C.scale(C.extent(pts.map(p => p.y), st.logY), [f.h, 0], st.logY);
    C.axes(f.g, x, y, f.w, f.h, title(vx), title(vy));
    C.el('rect', { x: 0, y: 0, width: f.w, height: f.h }, C.el('clipPath', { id: 'clip-sc' }, f.svg));

    // Least-squares fit in the displayed (possibly log) space
    let statsHtml = `<span><b>n</b> ${pts.length}</span>`;
    if (st.fit && pts.length > 2) {
      const tx = st.logX ? Math.log10 : v => v, ty = st.logY ? Math.log10 : v => v;
      const fit = C.linreg(pts.map(p => tx(p.x)), pts.map(p => ty(p.y)));
      if (isFinite(fit.slope)) {
        const [a, b] = x.domain.map(tx);
        const yAt = v => { const t = fit.intercept + fit.slope * v; return st.logY ? Math.pow(10, t) : t; };
        const xAt = v => st.logX ? Math.pow(10, v) : v;
        C.el('line', { class: 'fit', 'clip-path': 'url(#clip-sc)', x1: x(xAt(a)), y1: y(yAt(a)), x2: x(xAt(b)), y2: y(yAt(b)) }, f.g);
        const xn = st.logX ? 'log x' : 'x', yn = st.logY ? 'log y' : 'y';
        statsHtml += `<span><b>r</b> ${C.fmt(fit.r, 3)}</span><span><b>R²</b> ${C.fmt(fit.r2, 3)}</span>`
          + `<span>${yn} = ${C.fmt(fit.intercept)} ${fit.slope < 0 ? '−' : '+'} ${C.fmt(Math.abs(fit.slope))}·${xn}</span>`;
      }
    }
    $('sStats').innerHTML = statsHtml;

    const layer = C.el('g', {}, f.g);
    for (const p of pts) {
      p.px = x(p.x); p.py = y(p.y);
      C.el('circle', { class: 'pt', cx: p.px, cy: p.py, r: 4.5, fill: col.fn(p.r) }, layer);
    }
    for (const p of pts.filter(p => p.r.id === S.sel)) C.el('circle', { class: 'sel-ring', cx: p.px, cy: p.py, r: 7.5 }, f.g);
    hoverPoints(f, pts, p => {
      const d = col.describe && col.describe(p.r);
      return `<div class="t">${rowName(p.r)}</div>${tipRow(vx.label, valUnit(vx, p.x))}${tipRow(vy.label, valUnit(vy, p.y))}`
        + (d ? tipRow(d[0], d[1]) : tipRow('Texture', p.r.texture));
    }, p => select(p.r.id));

    const notes = [];
    if (missing) notes.push(`${missing} cores lack one of the values`);
    if (nonpos) notes.push(`${nonpos} non-positive values hidden on log axis`);
    notes.push('Click a point to inspect the core');
    $('sNote').textContent = notes.join(' · ');

    $('sTableBtn').textContent = st.table ? 'Hide table' : 'Show table';
    const tbl = $('sTable'); tbl.hidden = !st.table;
    if (st.table) {
      tbl.innerHTML = `<table><thead><tr><th class="l">Station</th><th>Depth</th><th>Core</th><th class="l">Texture</th><th>${vx.label}</th><th>${vy.label}</th></tr></thead><tbody>`
        + pts.map(p => `<tr><td class="l"><span class="sw" style="background:${col.fn(p.r)}"></span>${p.r.station}</td><td>${p.r.depth}</td><td>${p.r.core}</td><td class="l">${p.r.texture}</td><td>${C.fmt(p.x)}</td><td>${C.fmt(p.y)}</td></tr>`).join('')
        + '</tbody></table>';
    }
  }

  // ---------------------------------------------------------------------------
  // Histogram
  // ---------------------------------------------------------------------------
  function initHist() {
    const st = S.hi;
    fillVarSelect($('hVar'), st.v);
    $('hVar').addEventListener('change', e => { st.v = e.target.value; st.log = !!V[st.v].log; render(); });
    $('hBins').addEventListener('input', e => { st.bins = +e.target.value; render(); });
    $('hLog').addEventListener('change', e => { st.log = e.target.checked; render(); });
    $('hByDepth').addEventListener('change', e => { st.byDepth = e.target.checked; render(); });
  }

  function renderHist() {
    const st = S.hi, v = V[st.v];
    $('hVar').value = st.v; $('hBins').value = st.bins; $('hBinsVal').textContent = st.bins;
    $('hLog').checked = st.log; $('hByDepth').checked = st.byDepth;
    let nonpos = 0;
    const valid = filtered().filter(r => r[v.key] != null).filter(r => { if (st.log && r[v.key] <= 0) { nonpos++; return false; } return true; });
    const node = $('hChart');
    if (!valid.length) { node.innerHTML = '<p class="note">No data for this selection.</p>'; $('hNote').textContent = ''; return; }
    const tf = st.log ? Math.log10 : a => a, itf = st.log ? a => Math.pow(10, a) : a => a;
    const all = valid.map(r => tf(r[v.key]));
    const panels = st.byDepth
      ? DEPTHS.filter(d => F.depths.has(d)).map(d => ({ name: `${d} cm`, vals: valid.filter(r => r.depth === d).map(r => r[v.key]) }))
      : [{ name: null, vals: valid.map(r => r[v.key]) }];

    const lo = Math.min(...all), hi = Math.max(...all);
    const nb = st.bins, w = (hi - lo) / nb || 1;
    const edges = Array.from({ length: nb + 1 }, (_, i) => lo + i * w);
    const binOf = a => Math.min(nb - 1, Math.max(0, Math.floor((tf(a) - lo) / w)));
    for (const p of panels) { p.counts = new Array(nb).fill(0); for (const a of p.vals) p.counts[binOf(a)]++; }
    const ymax = Math.max(1, ...panels.flatMap(p => p.counts));

    const ph = st.byDepth ? (isMobile() ? 140 : 160) : (isMobile() ? 280 : 360), gap = 46, head = 22;
    const H = panels.length * (ph + head) + (panels.length - 1) * gap + 50;
    const f = C.frame(node, H, { top: 4, left: 60 }, 980);
    const x = C.scale([itf(lo), itf(hi)], [0, f.w], st.log);

    panels.forEach((p, i) => {
      const g = C.el('g', { transform: `translate(0,${i * (ph + head + gap) + head})` }, f.g);
      const y = C.scale([0, ymax * 1.08], [ph, 0]);
      C.axes(g, x, y, f.w, ph, i === panels.length - 1 ? title(v) : null, 'Cores', { xGrid: false });
      const vals = p.vals.slice().sort((a, b) => a - b), n = vals.length;
      const m = n ? C.mean(vals) : 0;
      const stats = n ? [p.name, `n ${n}`, `mean ${C.fmt(m)}`, `median ${C.fmt(C.quantile(vals, 0.5))}`,
        n > 1 ? `SD ${C.fmt(C.sd(vals))}` : null, n > 1 && m ? `CV ${Math.round(100 * C.sd(vals) / Math.abs(m))}%` : null,
        `range ${C.fmt(vals[0])}–${C.fmt(vals[n - 1])}`].filter(Boolean).join('  ·  ') : `${p.name || ''}  no data`;
      C.el('text', { class: 'panel-title', x: 0, y: -8, text: stats }, g);
      for (let b = 0; b < nb; b++) {
        const c = p.counts[b]; if (!c) continue;
        const x0 = x(itf(edges[b])) + 1, bw = Math.max(1, x(itf(edges[b + 1])) - 1 - x0), yy = y(c);
        const rr = Math.min(4, bw / 2, ph - yy);
        const d = `M${x0},${ph}V${yy + rr}Q${x0},${yy} ${x0 + rr},${yy}H${x0 + bw - rr}Q${x0 + bw},${yy} ${x0 + bw},${yy + rr}V${ph}Z`;
        const bar = C.el('path', { d, class: 'bar', fill: P.single }, g);
        bar.addEventListener('mousemove', ev => C.showTip(
          `<div class="t">${C.fmt(itf(edges[b]))} – ${C.fmt(itf(edges[b + 1]))} ${v.unit}</div>${tipRow('Cores', c)}${tipRow('Share', Math.round(100 * c / n) + '%')}${p.name ? tipRow('Depth', p.name) : ''}`, ev.clientX, ev.clientY));
        bar.addEventListener('mouseleave', C.hideTip);
      }
      if (n) {
        const md = C.quantile(vals, 0.5), mx = x(md);
        C.el('line', { class: 'med', x1: mx, x2: mx, y1: 0, y2: ph }, g);
        C.el('text', { class: 'med-label', x: mx + 4, y: 10, text: `median ${C.fmt(md)}` }, g);
      }
    });
    const notes = [`One value per core · ${valid.length} cores with data`];
    if (nonpos) notes.push(`${nonpos} non-positive values hidden on log scale`);
    if (st.log) notes.push('bins are equal width in log space');
    if (st.byDepth) notes.push('panels share the same axes');
    $('hNote').textContent = notes.join(' · ');
  }

  // ---------------------------------------------------------------------------
  // Texture triangle (USDA)
  // ---------------------------------------------------------------------------
  // Class polygons as [clay, silt, sand] vertices
  const USDA = {
    'sand': [[0, 0, 100], [10, 0, 90], [0, 15, 85]],
    'loamy sand': [[0, 15, 85], [10, 0, 90], [15, 0, 85], [0, 30, 70]],
    'sandy loam': [[0, 30, 70], [15, 0, 85], [20, 0, 80], [20, 28, 52], [7, 41, 52], [7, 50, 43], [0, 50, 50]],
    'loam': [[7, 41, 52], [20, 28, 52], [27, 28, 45], [27, 50, 23], [7, 50, 43]],
    'silt loam': [[0, 50, 50], [7, 50, 43], [27, 50, 23], [27, 73, 0], [12, 88, 0], [12, 80, 8], [0, 80, 20]],
    'silt': [[0, 80, 20], [12, 80, 8], [12, 88, 0], [0, 100, 0]],
    'sandy clay loam': [[20, 0, 80], [35, 0, 65], [35, 20, 45], [27, 28, 45], [20, 28, 52]],
    'clay loam': [[27, 28, 45], [40, 15, 45], [40, 40, 20], [27, 53, 20]],
    'silty clay loam': [[27, 53, 20], [40, 40, 20], [40, 60, 0], [27, 73, 0]],
    'sandy clay': [[35, 0, 65], [55, 0, 45], [35, 20, 45]],
    'silty clay': [[40, 40, 20], [40, 60, 0], [60, 40, 0]],
    'clay': [[40, 15, 45], [55, 0, 45], [100, 0, 0], [60, 40, 0], [40, 40, 20]],
  };
  const LABEL_AT = { 'loamy sand': [5, 10, 85], 'sand': [3, 4, 93], 'silt': [5, 88, 7], 'sandy loam': [10, 25, 65], 'silt loam': [15, 65, 20] };

  function initTexture() {
    colorOptions($('tColor'));
    $('tColor').addEventListener('change', e => { S.tx.color = e.target.value; render(); });
    $('tLabels').addEventListener('change', e => { S.tx.labels = e.target.checked; render(); });
  }

  function renderTexture() {
    $('tColor').value = S.tx.color; $('tLabels').checked = S.tx.labels;
    const rows = filtered().filter(r => r.sand != null && r.clay != null);
    const col = colorer(S.tx.color, rows);
    $('tLegend').innerHTML = col.legend;
    const node = $('tChart');
    const side = Math.min(node.clientWidth - 100, isMobile() ? 320 : 600);
    const th = side * Math.sqrt(3) / 2;
    const f = C.frame(node, th + 70, { top: 16, left: 50, right: 50, bottom: 54 }, side + 100);
    const pt = (clay, sand) => [(100 - sand - clay + clay / 2) / 100 * side, th - clay / 100 * th];
    const g = f.g;

    const grid = C.el('g', { class: 'tri-grid' }, g);
    for (let v = 10; v < 100; v += 10) {
      const seg = (a, b) => C.el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, grid);
      seg(pt(v, 100 - v), pt(v, 0));        // clay
      seg(pt(0, v), pt(100 - v, v));        // sand
      seg(pt(0, 100 - v), pt(100 - v, 0));  // silt
    }
    for (const [name, poly] of Object.entries(USDA)) {
      const d = 'M' + poly.map(([cl, , sa]) => pt(cl, sa).join(',')).join('L') + 'Z';
      C.el('path', { d, class: 'tri-class' + (F.texture === name ? ' on' : '') }, g);
    }
    C.el('path', { class: 'tri-edge', d: `M${pt(0, 100)}L${pt(100, 0)}L${pt(0, 0)}Z` }, g);
    const ax = C.el('g', { class: 'axis' }, g);
    for (let v = 0; v <= 100; v += 20) {
      let [x0, y0] = pt(v, 100 - v); C.el('text', { x: x0 - 8, y: y0, dy: '0.32em', 'text-anchor': 'end', text: v }, ax);
      [x0, y0] = pt(100 - v, 0); C.el('text', { x: x0 + 8, y: y0, dy: '0.32em', text: v }, ax);
      [x0, y0] = pt(0, v); C.el('text', { x: x0, y: y0 + 16, 'text-anchor': 'middle', text: v }, ax);
    }
    const [lx, ly] = pt(50, 50), [rx, ry] = pt(50, 0);
    C.el('text', { class: 'axis-title', 'text-anchor': 'middle', transform: `translate(${lx - 34},${ly}) rotate(-60)`, text: 'Clay (%)' }, g);
    C.el('text', { class: 'axis-title', 'text-anchor': 'middle', transform: `translate(${rx + 34},${ry}) rotate(60)`, text: 'Silt (%)' }, g);
    C.el('text', { class: 'axis-title', 'text-anchor': 'middle', x: side / 2, y: th + 38, text: 'Sand (%)' }, g);

    const pts = rows.map(r => { const [px, py] = pt(r.clay, r.sand); return { r, px, py }; });
    const layer = C.el('g', {}, g);
    for (const p of pts) C.el('circle', { class: 'pt', cx: p.px, cy: p.py, r: 4.5, fill: col.fn(p.r) }, layer);
    if (S.tx.labels) for (const [name, poly] of Object.entries(USDA)) {
      const c = LABEL_AT[name] || poly.reduce((a, p) => a.map((v, i) => v + p[i] / poly.length), [0, 0, 0]);
      const [x0, y0] = pt(c[0], c[2]);
      C.el('text', { class: 'tri-class-label', x: x0, y: y0, dy: '0.32em', text: name }, g);
    }
    for (const p of pts.filter(p => p.r.id === S.sel)) C.el('circle', { class: 'sel-ring', cx: p.px, cy: p.py, r: 7.5 }, g);
    hoverPoints(f, pts, p => {
      const d = col.describe && col.describe(p.r);
      return `<div class="t">${rowName(p.r)}</div>${tipRow('Class', p.r.texture)}${tipRow('Sand / silt / clay', `${C.fmt(p.r.sand, 0)} / ${C.fmt(p.r.silt, 0)} / ${C.fmt(p.r.clay, 0)} %`)}${d && d[0] !== 'Texture' ? tipRow(d[0], d[1]) : ''}`;
    }, p => select(p.r.id));
    const counts = {};
    for (const r of rows) counts[r.texture] = (counts[r.texture] || 0) + 1;
    $('tStats').innerHTML = `<span><b>n</b> ${rows.length} cores</span>` + Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `<span>${k} ${v}</span>`).join('');
  }

  // ---------------------------------------------------------------------------
  // Heat pulse: ΔT curves + thermal properties vs water content
  // ---------------------------------------------------------------------------
  const PROBE_SPACING = 0.006;   // m, KD2 Pro SH-1 dual needle
  const CS_MINERAL = 0.75;       // MJ Mg⁻¹ K⁻¹, typical specific heat of soil minerals
  const CW = 4.18;               // MJ m⁻³ K⁻¹, water

  function initPulse() {
    const pu = S.pu;
    if (pu.id == null) pu.id = cores.find(c => c.station === 'Manhattan' && c.meas.length >= 5)?.id ?? cores.find(c => c.meas.length)?.id;
    $('pStation').innerHTML = STATIONS.map(s => `<option>${s}</option>`).join('');
    const pick = () => {
      const st = $('pStation').value, d = +$('pDepth').value, k = +$('pCore').value;
      const c = cores.find(c => c.station === st && c.depth === d && c.core === k)
        || cores.find(c => c.station === st && c.depth === d) || cores.find(c => c.station === st);
      pu.id = c.id; render();
    };
    ['pStation', 'pDepth', 'pCore'].forEach(id => $(id).addEventListener('change', pick));
    $('pModel').addEventListener('change', e => { pu.model = e.target.checked; render(); });
    segment($('pProp'), pu.prop, v => { pu.prop = v; render(); });
  }
  function syncPulseControls() {
    const c = cores[S.pu.id];
    $('pStation').value = c.station;
    const depths = [...new Set(cores.filter(x => x.station === c.station).map(x => x.depth))].sort((a, b) => a - b);
    $('pDepth').innerHTML = depths.map(d => `<option value="${d}">${d} cm</option>`).join('');
    $('pDepth').value = c.depth;
    const cs = cores.filter(x => x.station === c.station && x.depth === c.depth).sort((a, b) => a.core - b.core);
    $('pCore').innerHTML = cs.map(x => `<option value="${x.core}">Core ${x.core} (${x.meas.length} states)</option>`).join('');
    $('pCore').value = c.core;
    $('pModel').checked = S.pu.model;
    $('pProp').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.pu.prop)));
  }

  // Ideal line-source heat-pulse response at distance r (Bristow et al. 1994)
  function lineSource(m, times) {
    const Dm = m.d * 1e-6, t0 = m.rt * 30, a = PROBE_SPACING ** 2 / (4 * Dm);
    return times.map(t => t <= 0 ? 0 : m.power / (4 * Math.PI * m.k) * (C.expint(a / t) - (t > t0 ? C.expint(a / (t - t0)) : 0)));
  }

  function pulseCurves(c) {
    return c.meas.filter(r => r.m.temps).map(r => {
      const m = r.m, times = m.temps.map((_, i) => i * m.rt);   // 60 readings over rt minutes -> rt s apart
      const ys = m.temps.map(t => t - m.temps[0]);
      let ip = 0; ys.forEach((v, i) => { if (v > ys[ip]) ip = i; });
      return { r, m, times, ys, ip, heat: m.rt * 30, color: moistColor(r), model: S.pu.model ? lineSource(m, times) : null };
    });
  }

  function renderPulse() {
    syncPulseControls();
    const c = cores[S.pu.id];
    $('pStats').innerHTML = `<span><b>${c.station}</b> · ${c.county} County</span><span>${c.depth} cm (${c.top}–${c.bottom} cm) · core ${c.core}</span><span>${c.texture}</span><span>BD ${C.fmt(c.bd, 2)} g cm⁻³</span><span>porosity ${C.fmt(c.por, 3)}</span>`;
    const curves = pulseCurves(c);
    // The square property chart sets the height; the ΔT chart matches it so the panels align
    const height = renderPropVsTheta(c);
    renderDeltaT(c, curves, height);
    renderPulseTable(c, curves);
  }

  function renderDeltaT(c, curves, height) {
    const present = MOISTURE.filter(mo => curves.some(k => k.r.moisture === mo));
    $('pLegend').innerHTML = present.map(mo => legendItem(P.moisture[MOISTURE.indexOf(mo)], mo, 'line')).join('')
      + (S.pu.model ? `<span class="item"><svg width="18" height="4"><line x1="0" x2="18" y1="2" y2="2" stroke="currentColor" stroke-width="1.5" stroke-dasharray="4 3"/></svg>Line-source model</span>` : '');
    const node = $('pChart');
    if (!curves.length) { node.innerHTML = '<p class="note">No raw heat-pulse curves for this core.</p>'; $('pNote').textContent = ''; return; }
    const f = C.frame(node, height, { left: 56, right: 96, top: 12, bottom: 46 });
    const tmax = Math.max(...curves.map(k => k.times[k.times.length - 1]));
    const allY = curves.flatMap(k => k.model ? [...k.ys, ...k.model] : k.ys);
    const ymax = Math.max(...allY);
    const x = C.scale([0, tmax], [0, f.w]);
    const y = C.scale([Math.min(0, ...allY), ymax * 1.08], [f.h, 0]);
    const heat = curves[0].heat;
    C.el('rect', { class: 'heat-band', x: 0, y: 0, width: x(heat), height: f.h }, f.g);
    C.el('text', { class: 'band-label', x: 6, y: 14, text: `heater on (${heat} s)` }, f.g);
    C.axes(f.g, x, y, f.w, f.h, 'Time (s)', 'ΔT (°C)');

    const line = (ts, ys) => 'M' + ts.map((t, i) => `${x(t).toFixed(1)},${y(ys[i]).toFixed(1)}`).join('L');
    for (const k of curves) {
      if (k.model) C.el('path', { class: 'curve model', d: line(k.times, k.model), stroke: k.color }, f.g);
      C.el('path', { class: 'curve', d: line(k.times, k.ys), stroke: k.color }, f.g);
    }
    // Peak markers: ΔTmax sets C, time of peak sets D (dual-probe theory)
    for (const k of curves) C.el('circle', { class: 'peak', cx: x(k.times[k.ip]), cy: y(k.ys[k.ip]), r: 4, fill: k.color }, f.g);
    // Direct labels at the right end, nudged apart
    const labels = curves.map(k => ({ y: y(k.ys[k.ys.length - 1]), text: STATE[k.r.state].label })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
    const over = labels.length ? labels[labels.length - 1].y - f.h : 0;
    if (over > 0) labels.forEach(l => { l.y -= over; });
    for (const l of labels) C.el('text', { class: 'curve-label', x: f.w + 8, y: l.y, dy: '0.32em', text: l.text }, f.g);

    const cross = C.el('line', { class: 'crosshair', y1: 0, y2: f.h, visibility: 'hidden' }, f.g);
    const dots = curves.map(k => C.el('circle', { r: 4, fill: k.color, class: 'pt', visibility: 'hidden' }, f.g));
    const hit = C.el('rect', { x: 0, y: 0, width: f.w, height: f.h, fill: 'transparent' }, f.g);
    hit.addEventListener('mousemove', ev => {
      const r = f.svg.getBoundingClientRect();
      const t = x.inv((ev.clientX - r.left) * (f.width / r.width) - f.m.left);
      const k0 = curves[0], i = Math.max(0, Math.min(k0.times.length - 1, Math.round(t / k0.m.rt)));
      const tx = x(k0.times[i]);
      cross.setAttribute('x1', tx); cross.setAttribute('x2', tx); cross.setAttribute('visibility', 'visible');
      curves.forEach((k, j) => { dots[j].setAttribute('cx', tx); dots[j].setAttribute('cy', y(k.ys[i])); dots[j].setAttribute('visibility', 'visible'); });
      C.showTip(`<div class="t">t = ${k0.times[i]} s · ${k0.times[i] <= heat ? 'heating' : 'cooling'}</div>`
        + curves.map(k => tipRow(`<span class="sw" style="background:${k.color}"></span>${STATE[k.r.state].label}`, `${C.fmt(k.ys[i], 3)} °C${k.model ? ` <span class="flag">model ${C.fmt(k.model[i], 3)}</span>` : ''}`)).join(''),
        ev.clientX, ev.clientY);
    });
    hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); C.hideTip(); });

    $('pNote').textContent = `KD2 Pro SH-1 dual-needle probe, 6 mm spacing; 60 readings ${curves[0].m.rt} s apart. Dots mark the peak: a lower ΔTmax means higher heat capacity, an earlier peak means higher diffusivity.`
      + (S.pu.model ? ' Dashed: ideal line-source model from the reported λ, D and heater power (≈6% above observed peaks on average).' : '');
  }

  function renderPropVsTheta(c) {
    const pr = PROP[S.pu.prop], key = S.pu.prop;
    const ctx = meas.filter(r => r.theta != null && r.core !== c);
    const own = c.meas.filter(r => r.theta != null).sort((a, b) => a.theta - b.theta);
    const node = $('pPropChart');
    const f = C.squareFrame(node, { left: 56, right: 16, top: 12, bottom: 46 }, isMobile() ? 300 : 440);
    const xs = [...ctx, ...own].map(r => r.theta), ys = [...ctx, ...own].map(r => r[key]);
    const x = C.scale(C.extent(xs), [0, f.w]);
    const y = C.scale(C.extent(ys), [f.h, 0]);
    C.axes(f.g, x, y, f.w, f.h, 'Water content θ (cm³ cm⁻³)', `${pr.sym} (${pr.unit})`);
    C.el('rect', { x: 0, y: 0, width: f.w, height: f.h }, C.el('clipPath', { id: 'clip-pp' }, f.svg));

    const pts = [];
    const bg = C.el('g', {}, f.g);
    for (const r of ctx) {
      const p = { r, px: x(r.theta), py: y(r[key]) }; pts.push(p);
      C.el('circle', { class: 'ctx', cx: p.px, cy: p.py, r: 3 }, bg);
    }
    // de Vries (1963) mixing model for this core: C = ρb·cs + θ·Cw
    if (key === 'cv' && c.bd != null) {
      const [t0, t1] = x.domain, cAt = t => c.bd * CS_MINERAL + CW * t;
      C.el('line', { class: 'ref-line', 'clip-path': 'url(#clip-pp)', x1: x(t0), y1: y(cAt(t0)), x2: x(t1), y2: y(cAt(t1)) }, f.g);
    }
    if (own.length > 1) C.el('path', { class: 'trace', d: 'M' + own.map(r => `${x(r.theta)},${y(r[key])}`).join('L') }, f.g);
    for (const r of own) {
      const p = { r, px: x(r.theta), py: y(r[key]), own: true }; pts.push(p);
      C.el('circle', { class: 'pt', cx: p.px, cy: p.py, r: 5.5, fill: moistColor(r) }, f.g);
    }
    hoverPoints(f, pts, p => `<div class="t">${rowName(p.r.core)}${p.own ? '' : ' <span class="flag">other core</span>'}</div>`
      + tipRow('State', STATE[p.r.state].label) + tipRow('θ', `${C.fmt(p.r.theta, 3)} cm³ cm⁻³`) + tipRow(pr.sym, `${C.fmt(p.r[key], 3)} ${pr.unit}`)
      + tipRow('Texture', p.r.core.texture),
    p => { S.pu.id = p.r.core.id; render(); });

    const dry = c.meas.length - own.length;
    $('pPropNote').textContent = `Colored: this core, joined in order of θ. Gray: all other cores (${ctx.length} measurements); click one to open it.`
      + (key === 'cv' ? ` Dashed: de Vries mixing model C = ρb·cs + θ·Cw for this core (cs = ${CS_MINERAL} MJ Mg⁻¹ K⁻¹, Cw = ${CW} MJ m⁻³ K⁻¹).` : '')
      + (own.some(r => r.state === 'od40') ? ' Oven-dry (40 °C) θ is estimated from the mean 40–105 °C mass difference by texture.' : '')
      + (dry ? ` ${dry} state${dry > 1 ? 's have' : ' has'} no measured θ and ${dry > 1 ? 'are' : 'is'} listed in the table only.` : '');
    return f.height;
  }

  function renderPulseTable(c, curves) {
    const nearNote = 'The 2025 summary had a one-digit transcription typo in λ, C or D; corrected to the raw instrument value (record linked on the other 3 of λ, C, D, start temperature). See qaqc_log.';
    $('pTable').innerHTML = `<table><thead><tr><th class="l">State</th><th>θ (cm³ cm⁻³)</th><th>λ (W m⁻¹ K⁻¹)</th><th>C (MJ m⁻³ K⁻¹)</th><th>D (mm² s⁻¹)</th>`
      + `<th>ΔT max (°C)</th><th>Time of peak (s)</th><th title="Soil temperature at the start of the reading (KD2 Pro Temp(0)); the value reported in the summary sheet">Temperature (°C)</th><th class="l">Measured</th><th class="l">Raw link</th></tr></thead><tbody>`
      + c.meas.map(r => {
        const m = r.m, k = curves.find(k => k.r === r);
        return `<tr><td class="l"><span class="sw" style="background:${moistColor(r)}"></span>${STATE[r.state].label}</td>`
          + `<td>${C.fmt(r.theta, 3)}</td><td>${C.fmt(r.lam, 3)}</td><td>${C.fmt(r.cv, 3)}</td><td>${C.fmt(r.dif, 3)}</td>`
          + `<td>${k ? C.fmt(k.ys[k.ip], 3) : '–'}</td><td>${k ? k.times[k.ip] : '–'}</td><td>${C.fmt(m.t0, 2)}</td>`
          + `<td class="l">${m.time || '<span class="flag">clock not set</span>'}</td>`
          + `<td class="l">${m.match === 'near' ? `<span class="flag" title="${nearNote}">typo corrected ⓘ</span>` : m.match ? 'exact' : '–'}</td></tr>`;
      }).join('') + '</tbody></table>';
  }

  // ---------------------------------------------------------------------------
  // View switching & boot
  // ---------------------------------------------------------------------------
  function switchView(v) {
    S.view = v;
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    document.querySelectorAll('.view').forEach(s => { s.hidden = s.id !== `view-${v}`; });
    $('filters').hidden = v === 'pulse';
    window.scrollTo(0, 0);
    render();
  }

  function render() {
    C.hideTip();
    syncFilters();
    if (S.view === 'scatter') { renderScatter(); renderDetail($('detail')); }
    if (S.view === 'hist') renderHist();
    if (S.view === 'texture') { renderTexture(); renderDetail($('detail2')); }
    if (S.view === 'pulse') renderPulse();
    saveHash();
  }

  function boot() {
    $('summary').textContent = `${STATIONS.length} stations · ${cores.length} undisturbed cores at 5, 10, 20 and 50 cm · ${meas.length.toLocaleString()} heat-pulse measurements`;
    loadHash();
    initFilters();
    initScatter();
    initHist();
    initTexture();
    initPulse();
    document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
    let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(render, 120); });
    switchView(S.view);
  }
  boot();
})();
