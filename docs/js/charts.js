// Small, dependency-free SVG charting helpers shared by the dashboard views.
const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs = {}, parent) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  // ---------- Scales ----------
  function niceStep(span, count) {
    const raw = span / Math.max(count, 1);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    return (f >= 5 ? 10 : f >= 2 ? 5 : f >= 1 ? 2 : 1) * mag;
  }

  function linearTicks(lo, hi, count = 6) {
    if (lo === hi) return [lo];
    const step = niceStep(hi - lo, count);
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(12));
    return out;
  }

  function logTicks(lo, hi) {
    const a = Math.floor(Math.log10(lo)), b = Math.ceil(Math.log10(hi));
    const mult = b - a <= 2 ? [1, 2, 5] : [1];
    const out = [];
    for (let e = a; e <= b; e++) for (const m of mult) {
      const v = m * Math.pow(10, e);
      if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
    }
    return out;
  }

  // Domain padded and rounded so points never sit on the frame
  function extent(values, log, pad = 0.04) {
    let lo = Infinity, hi = -Infinity;
    for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!isFinite(lo)) return log ? [1, 10] : [0, 1];
    if (log) {
      const l0 = Math.log10(lo), l1 = Math.log10(hi), p = Math.max((l1 - l0) * pad, 0.05);
      return [Math.pow(10, l0 - p), Math.pow(10, l1 + p)];
    }
    if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1; }
    const p = (hi - lo) * pad;
    return [lo - p, hi + p];
  }

  function scale(domain, range, log = false) {
    const [d0, d1] = log ? domain.map(Math.log10) : domain;
    const [r0, r1] = range;
    const f = v => r0 + ((log ? Math.log10(v) : v) - d0) / (d1 - d0) * (r1 - r0);
    f.inv = p => { const v = d0 + (p - r0) / (r1 - r0) * (d1 - d0); return log ? Math.pow(10, v) : v; };
    f.ticks = n => log ? logTicks(...domain) : linearTicks(domain[0], domain[1], n);
    f.domain = domain; f.range = range; f.log = log;
    return f;
  }

  // ---------- Formatting ----------
  function fmt(v, digits) {
    if (v == null || !isFinite(v)) return '–';
    if (digits != null) return v.toFixed(digits);
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1000) return Math.round(v).toLocaleString();
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.01) return v.toFixed(3);
    return v.toPrecision(2);
  }
  function tickFmt(ticks) {
    // Enough decimals to tell neighbouring ticks apart, no more
    return v => {
      if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString();
      const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : Math.abs(v) || 1;
      const d = Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9)));
      return v.toFixed(d);
    };
  }
  function logTickFmt(v) {
    return v >= 1e5 || v < 0.001 ? v.toExponential(0).replace('e+', 'e') : String(+v.toPrecision(3));
  }

  // ---------- Frame & axes ----------
  function frame(container, height, margin, maxWidth = Infinity) {
    container.innerHTML = '';
    const width = Math.max(Math.min(container.clientWidth, maxWidth), 260);
    const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, height, role: 'img', style: `max-width:${width}px` }, container);
    const m = Object.assign({ top: 12, right: 16, bottom: 44, left: 56 }, margin);
    const g = el('g', { transform: `translate(${m.left},${m.top})` }, svg);
    return { svg, g, width, height, m, w: width - m.left - m.right, h: height - m.top - m.bottom };
  }

  // Square plotting area (x vs y relationships read best at ~1:1), capped in size
  function squareFrame(container, margin, maxSide = 600) {
    const m = Object.assign({ top: 12, right: 16, bottom: 44, left: 56 }, margin);
    const side = Math.max(220, Math.min(container.clientWidth - m.left - m.right, maxSide));
    return frame(container, side + m.top + m.bottom, m, side + m.left + m.right);
  }

  function axes(g, x, y, w, h, xTitle, yTitle, opts = {}) {
    const grid = el('g', { class: 'grid' }, g);
    const ax = el('g', { class: 'axis' }, g);
    const xt = x.ticks(Math.max(3, Math.round(w / 90)));
    const yt = y.ticks(Math.max(3, Math.round(h / 60)));
    const xf = x.log ? logTickFmt : tickFmt(xt);
    const yf = y.log ? logTickFmt : tickFmt(yt);
    for (const t of yt) {
      const py = y(t);
      el('line', { x1: 0, x2: w, y1: py, y2: py }, grid);
      el('text', { x: -8, y: py, dy: '0.32em', 'text-anchor': 'end', text: yf(t) }, ax);
    }
    if (opts.xGrid !== false) for (const t of xt) el('line', { x1: x(t), x2: x(t), y1: 0, y2: h }, grid);
    el('line', { x1: 0, x2: w, y1: h, y2: h }, ax);
    if (!opts.hideXTicks) for (const t of xt) el('text', { x: x(t), y: h + 16, 'text-anchor': 'middle', text: xf(t) }, ax);
    if (xTitle) el('text', { class: 'axis-title', x: w / 2, y: h + 36, 'text-anchor': 'middle', text: xTitle }, g);
    if (yTitle) el('text', { class: 'axis-title', transform: `translate(${-44},${h / 2}) rotate(-90)`, 'text-anchor': 'middle', text: yTitle }, g);
  }

  // ---------- Tooltip ----------
  const tip = () => document.getElementById('tooltip');
  function showTip(html, cx, cy) {
    const t = tip();
    t.innerHTML = html; t.hidden = false;
    const r = t.getBoundingClientRect();
    let x = cx + 14, y = cy + 14;
    if (x + r.width > window.innerWidth - 8) x = cx - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = cy - r.height - 14;
    t.style.left = Math.max(8, x) + 'px'; t.style.top = Math.max(8, y) + 'px';
  }
  function hideTip() { tip().hidden = true; }

  // Nearest-point hover/click over a whole plot area (hit radius >= 24px)
  function pointer(svg, g, m, pts, { onHover, onClick, radius = 24 }) {
    const hit = el('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: 'transparent' });
    svg.insertBefore(hit, svg.firstChild);
    const find = ev => {
      const r = svg.getBoundingClientRect();
      const sx = svg.viewBox.baseVal.width / r.width;
      const px = (ev.clientX - r.left) * sx - m.left, py = (ev.clientY - r.top) * sx - m.top;
      let best = null, bd = radius * radius;
      for (const p of pts) {
        const d = (p.px - px) ** 2 + (p.py - py) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    };
    svg.addEventListener('mousemove', ev => onHover(find(ev), ev));
    svg.addEventListener('mouseleave', () => onHover(null));
    if (onClick) svg.addEventListener('click', ev => { const p = find(ev); if (p) onClick(p); });
  }

  // ---------- Color ----------
  // CIELAB (D65) -> sRGB hex; used to paint real soil colors
  function lab2hex(L, a, b) {
    if (L == null || a == null || b == null) return null;
    const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    const inv = t => t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787;
    const X = 0.95047 * inv(fx), Y = 1.0 * inv(fy), Z = 1.08883 * inv(fz);
    const lin = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.2040 * Y + 1.0570 * Z];
    return '#' + lin.map(c => {
      c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
      return Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0');
    }).join('');
  }
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function ramp(stops, t) {
    t = Math.min(1, Math.max(0, t));
    const i = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
    const f = t * (stops.length - 1) - i;
    const a = hexRgb(stops[i]), b = hexRgb(stops[i + 1]);
    return '#' + a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, '0')).join('');
  }

  // ---------- Stats ----------
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  function quantile(sorted, q) {
    const p = (sorted.length - 1) * q, i = Math.floor(p);
    return sorted[i] + (sorted[Math.min(i + 1, sorted.length - 1)] - sorted[i]) * (p - i);
  }
  function sd(a) { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); }
  function linreg(xs, ys) {
    const n = xs.length, mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    const slope = sxy / sxx, r = sxy / Math.sqrt(sxx * syy);
    return { slope, intercept: my - slope * mx, r, r2: r * r, n };
  }

  // Exponential integral E1(x), for the line-source heat-pulse model
  function expint(x) {
    if (x <= 0) return Infinity;
    if (x < 1) {
      let sum = 0, term = 1;
      for (let k = 1; k < 60; k++) { term *= -x / k; sum += term / k; if (Math.abs(term / k) < 1e-12) break; }
      return -0.5772156649015329 - Math.log(x) - sum;
    }
    let b = x + 1, c = 1e30, d = 1 / b, h = d;
    for (let i = 1; i < 200; i++) {
      const an = -i * i; b += 2;
      d = 1 / (an * d + b); c = b + an / c;
      const del = c * d; h *= del;
      if (Math.abs(del - 1) < 1e-12) break;
    }
    return h * Math.exp(-x);
  }

  return { el, scale, extent, fmt, frame, squareFrame, axes, showTip, hideTip, pointer, lab2hex, ramp, mean, sd, quantile, linreg, expint };
})();
