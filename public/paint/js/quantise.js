// Colour reduction for /paint pictures: k-means in Lab colour space, merging
// near-identical colours, smoothing, and palette order. Pure functions with no
// I/O. The page uses them to turn her own photos into pictures, on her iPad;
// tools/convert.mjs uses the same code for the library. One copy, two users.

export const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcd'; // 30 colours at most
export const EMPTY = '.';

// ---- seeded random, so the same image + settings always gives the same picture
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ---- sRGB <-> CIE Lab (D65). Clustering in Lab groups colours the way eyes do.
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function f(t) { return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116; }
export function rgbToLab([r, g, b]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export function dist2(a, b) { const d0 = a[0] - b[0], d1 = a[1] - b[1], d2 = a[2] - b[2]; return d0 * d0 + d1 * d1 + d2 * d2; }

export function hex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
export function parseHex(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); }

// ---- k-means++ over Lab points. Returns { labels, centres } (centres in Lab).
export function kmeans(points, k, { iterations = 30, seed = 7 } = {}) {
  const n = points.length;
  const rand = rng(seed);
  k = Math.min(k, n);
  const centres = [points[Math.floor(rand() * n)].slice()];
  const d = new Float64Array(n).fill(Infinity);
  while (centres.length < k) {
    let sum = 0;
    const last = centres[centres.length - 1];
    for (let i = 0; i < n; i++) { d[i] = Math.min(d[i], dist2(points[i], last)); sum += d[i]; }
    if (sum === 0) break; // fewer distinct colours than k
    let r = rand() * sum, i = 0;
    for (; i < n - 1; i++) { r -= d[i]; if (r <= 0) break; }
    centres.push(points[i].slice());
  }
  const labels = new Int32Array(n);
  for (let it = 0; it < iterations; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < centres.length; c++) { const dd = dist2(points[i], centres[c]); if (dd < bd) { bd = dd; best = c; } }
      if (labels[i] !== best) { labels[i] = best; moved++; }
    }
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) { const s = sums[labels[i]]; s[0] += points[i][0]; s[1] += points[i][1]; s[2] += points[i][2]; s[3]++; }
    sums.forEach((s, c) => { if (s[3]) centres[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    if (it > 0 && moved === 0) break;
  }
  return { labels, centres };
}

// ---- turn a w×h RGBA buffer into a picture grid
// colors: target colour count. mergeBelow: Lab distance under which two
// colours are merged (near-identical greys are the commonest complaint about
// colour-by-number apps). clean: passes of lone-cell removal.
// smooth: passes of a 3x3 majority filter (a cell joins a colour that holds
// at least 5 of its 8 neighbours). Flattens mottled fur and backgrounds into
// areas that are pleasant to fill.
export function quantise(rgba, w, h, { colors = 16, mergeBelow = 7, clean = 1, smooth = 0, seed = 7 } = {}) {
  const idx = [], pts = [], rgbs = [];
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] < 128) continue;
    const rgb = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]];
    idx.push(i); rgbs.push(rgb); pts.push(rgbToLab(rgb));
  }
  if (!pts.length) throw new Error('image is fully transparent');
  const { labels, centres } = kmeans(pts, Math.min(colors, KEYS.length), { seed });

  // merge near-duplicates: repeatedly join the closest pair under the threshold
  const parent = centres.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const count = new Array(centres.length).fill(0);
  labels.forEach(l => count[l]++);
  const lab = centres.map(c => c.slice());
  for (;;) {
    let bi = -1, bj = -1, bd = mergeBelow * mergeBelow;
    const roots = lab.map((_, i) => i).filter(i => find(i) === i && count[i] > 0);
    for (let a = 0; a < roots.length; a++) for (let b = a + 1; b < roots.length; b++) {
      const dd = dist2(lab[roots[a]], lab[roots[b]]);
      if (dd < bd) { bd = dd; bi = roots[a]; bj = roots[b]; }
    }
    if (bi < 0) break;
    const t = count[bi] + count[bj];
    lab[bi] = lab[bi].map((v, q) => (v * count[bi] + lab[bj][q] * count[bj]) / t);
    count[bi] = t; count[bj] = 0; parent[bj] = bi;
  }

  // cell -> cluster root
  const cell = new Int32Array(w * h).fill(-1);
  idx.forEach((i, j) => { cell[i] = find(labels[j]); });

  for (let pass = 0; pass < smooth; pass++) {
    const next = cell.slice();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x; if (cell[i] < 0) continue;
      const tally = {};
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const v = cell[i + dy * w + dx]; if (v >= 0) tally[v] = (tally[v] || 0) + 1;
      }
      for (const [v, c] of Object.entries(tally)) if (c >= 5 && +v !== cell[i]) { next[i] = +v; break; }
    }
    cell.set(next);
  }

  // lone-cell cleanup: a cell with no 4-neighbour of its colour takes the
  // commonest neighbouring colour. Fewer one-cell specks to hunt for.
  for (let pass = 0; pass < clean; pass++) {
    const next = cell.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, c = cell[i];
      if (c < 0) continue;
      const nb = [];
      if (x > 0) nb.push(cell[i - 1]); if (x < w - 1) nb.push(cell[i + 1]);
      if (y > 0) nb.push(cell[i - w]); if (y < h - 1) nb.push(cell[i + w]);
      if (nb.includes(c)) continue;
      const tally = {};
      for (const v of nb) if (v >= 0) tally[v] = (tally[v] || 0) + 1;
      const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] >= 2) next[i] = +top[0];
    }
    cell.set(next);
  }

  // palette colour = mean sRGB of its cells (truer than converting Lab back)
  const acc = new Map();
  idx.forEach((i, j) => {
    const c = cell[i]; if (c < 0) return;
    const a = acc.get(c) || [0, 0, 0, 0];
    a[0] += rgbs[j][0]; a[1] += rgbs[j][1]; a[2] += rgbs[j][2]; a[3]++;
    acc.set(c, a);
  });
  const clusters = [...acc.entries()].map(([c, a]) => ({ c, rgb: [a[0] / a[3], a[1] / a[3], a[2] / a[3]], n: a[3] }));
  sortPalette(clusters);
  const keyOf = new Map(clusters.map((cl, i) => [cl.c, KEYS[i]]));
  const grid = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) { const c = cell[y * w + x]; row += c < 0 ? EMPTY : keyOf.get(c); }
    grid.push(row);
  }
  return { grid, pal: clusters.map((cl, i) => ({ k: KEYS[i], hex: hex(cl.rgb) })) };
}

// light-to-dark within hue families, greys first: neighbouring numbers look alike
export function sortPalette(list) {
  const hsl = ({ rgb: [r, g, b] }) => {
    const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2, d = mx - mn;
    let hue = 0;
    if (d > 0) {
      if (mx === r / 255) hue = ((g - b) / 255 / d) % 6; else if (mx === g / 255) hue = (b - r) / 255 / d + 2; else hue = (r - g) / 255 / d + 4;
      hue = (hue * 60 + 360) % 360;
    }
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return { hue, s, l };
  };
  list.forEach(x => { x.hsl = hsl(x); });
  list.sort((a, b) => {
    const ga = a.hsl.s < 0.12, gb = b.hsl.s < 0.12;
    if (ga !== gb) return ga ? -1 : 1;
    if (ga) return b.hsl.l - a.hsl.l;
    const ba = Math.floor(((a.hsl.hue + 15) % 360) / 30), bb = Math.floor(((b.hsl.hue + 15) % 360) / 30);
    return ba - bb || b.hsl.l - a.hsl.l;
  });
  list.forEach(x => delete x.hsl);
  return list;
}

// ---- colour boost before reducing (the browser's stand-in for sharp's
// normalise + modulate): stretch brightness between the 1st and 99th
// percentile, then push saturation by `amount`. Works in place on RGBA.
export function boost(rgba, amount = 1.2) {
  const n = rgba.length / 4, hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2])]++;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.01) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let r = (rgba[o] - lo) * 255 / span, g = (rgba[o + 1] - lo) * 255 / span, b = (rgba[o + 2] - lo) * 255 / span;
    const grey = 0.299 * r + 0.587 * g + 0.114 * b;
    r = grey + (r - grey) * amount; g = grey + (g - grey) * amount; b = grey + (b - grey) * amount;
    rgba[o] = Math.max(0, Math.min(255, r)); rgba[o + 1] = Math.max(0, Math.min(255, g)); rgba[o + 2] = Math.max(0, Math.min(255, b));
  }
  return rgba;
}
