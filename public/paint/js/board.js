// The colouring board: draws a picture on a canvas and turns touches, Apple
// Pencil, mouse and trackpad into fills, pans and zooms.
//
// One finger / Pencil / mouse: a tap fills the whole patch of touching cells
// with that number, in a quick ripple; a drag sweeps cell by cell. Only cells
// of the selected colour take it, so nothing ever gets the wrong colour. Two fingers: pinch
// to zoom and pan. Wheel / trackpad: zoom; right- or middle-drag: pan.

const EMPTY = '.';
const HIGHLIGHT = [196, 166, 240];
const NUMBERS_AT = 15;   // CSS px per cell before numbers are drawn
const LINES_AT = 7;      // ...and before grid lines are drawn
const MAX_CELL = 72;     // most zoomed in, CSS px per cell
const CANCEL_STROKE_MS = 250; // a second finger this soon turns a fill into a pinch

export function parseHex(h) { return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); }
export function luminance([r, g, b]) { return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }

/** Turn a picture JSON into flat arrays the board works with. */
export function prepare(pic) {
  const keyIndex = new Map(pic.pal.map((c, i) => [c.k, i]));
  const n = pic.w * pic.h;
  const target = new Int16Array(n).fill(-1);
  const totals = new Array(pic.pal.length).fill(0);
  for (let y = 0; y < pic.h; y++) for (let x = 0; x < pic.w; x++) {
    const ch = pic.grid[y][x];
    if (ch === EMPTY) continue;
    const ci = keyIndex.get(ch);
    target[y * pic.w + x] = ci; totals[ci]++;
  }
  const rgb = pic.pal.map(c => parseHex(c.hex));
  // unfilled cells show a faint grey ghost of the picture
  const ghost = rgb.map(c => { const g = Math.round(250 - (1 - luminance(c)) * 52); return [g, g, g]; });
  return { w: pic.w, h: pic.h, n, target, totals, rgb, ghost, colourable: totals.reduce((a, b) => a + b, 0) };
}

/** Draw a small preview (gallery thumbnails, the finished card). */
export function drawThumb(canvas, P, filled, { pixel = 0 } = {}) {
  const px = pixel || Math.max(1, Math.floor(canvas.width / Math.max(P.w, P.h)));
  canvas.width = P.w * px; canvas.height = P.h * px;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(P.w, P.h);
  for (let i = 0; i < P.n; i++) {
    const t = P.target[i], o = i * 4;
    if (t < 0) { img.data[o + 3] = 0; continue; }
    const c = filled && filled[i] ? P.rgb[t] : P.ghost[t];
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  const tmp = document.createElement('canvas'); tmp.width = P.w; tmp.height = P.h;
  tmp.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export class Board {
  constructor(canvas, P, filled, hooks = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.P = P; this.filled = filled; this.hooks = hooks;
    this.selected = 0;
    this.remaining = P.totals.slice();
    for (let i = 0; i < P.n; i++) if (filled[i] && P.target[i] >= 0) this.remaining[P.target[i]]--;
    this.done = P.colourable - this.remaining.reduce((a, b) => a + b, 0);
    this.undoStack = []; this.redoStack = [];
    this.pointers = new Map(); this.mode = 'none'; this.stroke = null;
    this.scale = 10; this.ox = 0; this.oy = 0; this.fitted = false;

    // base layer: one pixel per cell, scaled up with no smoothing
    this.base = document.createElement('canvas'); this.base.width = P.w; this.base.height = P.h;
    this.bctx = this.base.getContext('2d');
    this.bimg = this.bctx.createImageData(P.w, P.h);
    this.paintBase();

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.noGesture = e => e.preventDefault();
    // Every listener hangs off one signal, so destroy() really lets go. The
    // canvas element is reused for the next picture; a listener left behind
    // would redraw the old picture over the new one.
    this.life = new AbortController();
    const signal = this.life.signal;
    canvas.addEventListener('pointerdown', this.onPointerDown, { signal });
    canvas.addEventListener('pointermove', this.onPointerMove, { signal });
    canvas.addEventListener('pointerup', this.onPointerUp, { signal });
    canvas.addEventListener('pointercancel', this.onPointerUp, { signal });
    canvas.addEventListener('wheel', this.onWheel, { passive: false, signal });
    canvas.addEventListener('contextmenu', this.noGesture, { signal });
    // Safari's own pinch-zoom of the page
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, this.noGesture, { signal });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement);
    this.resize();
  }

  destroy() {
    this.dead = true;
    if (this.anim) cancelAnimationFrame(this.anim);
    this.life.abort();
    this.ro.disconnect();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // ---------- drawing
  cellColour(i) {
    const t = this.P.target[i];
    if (t < 0) return null;
    if (this.filled[i]) return this.P.rgb[t];
    if (t === this.selected) {
      // the cells still to do for this colour: one soft lavender, whatever the
      // colour, so they stand out from the grey ghost even for pale colours
      return HIGHLIGHT;
    }
    return this.P.ghost[t];
  }
  paintCell(i) {
    const c = this.cellColour(i), o = i * 4, d = this.bimg.data;
    if (!c) { d[o + 3] = 0; return; }
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  paintBase() {
    for (let i = 0; i < this.P.n; i++) this.paintCell(i);
    this.bctx.putImageData(this.bimg, 0, 0);
  }
  requestDraw() {
    if (this.raf || this.dead) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }
  draw() {
    if (this.dead) return;
    const { ctx, P } = this, dpr = this.dpr, s = this.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    // a soft paper behind the picture
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(255, 79, 163, 0.25)'; ctx.shadowBlur = 18;
    ctx.fillRect(this.ox, this.oy, P.w * s, P.h * s);
    ctx.shadowBlur = 0;
    ctx.drawImage(this.base, this.ox, this.oy, P.w * s, P.h * s);

    const cw = this.cssW, ch = this.cssH;
    const x0 = Math.max(0, Math.floor(-this.ox / s)), y0 = Math.max(0, Math.floor(-this.oy / s));
    const x1 = Math.min(P.w, Math.ceil((cw - this.ox) / s)), y1 = Math.min(P.h, Math.ceil((ch - this.oy) / s));
    if (this.finishedView) return;

    if (s >= LINES_AT) {
      ctx.beginPath();
      ctx.strokeStyle = `rgba(59, 31, 51, ${Math.min(0.16, 0.04 + (s - LINES_AT) * 0.01)})`;
      ctx.lineWidth = 1 / dpr;
      for (let x = x0; x <= x1; x++) { const X = Math.round((this.ox + x * s) * dpr) / dpr; ctx.moveTo(X, this.oy + y0 * s); ctx.lineTo(X, this.oy + y1 * s); }
      for (let y = y0; y <= y1; y++) { const Y = Math.round((this.oy + y * s) * dpr) / dpr; ctx.moveTo(this.ox + x0 * s, Y); ctx.lineTo(this.ox + x1 * s, Y); }
      ctx.stroke();
    }
    if (s >= NUMBERS_AT) {
      const fs = Math.min(22, s * 0.48);
      ctx.font = `600 ${fs}px Fredoka, "Quicksand", system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = y * P.w + x, t = P.target[i];
        if (t < 0 || this.filled[i]) continue;
        ctx.fillStyle = t === this.selected ? '#3B1F33' : 'rgba(59, 31, 51, 0.42)';
        ctx.fillText(String(t + 1), this.ox + (x + 0.5) * s, this.oy + (y + 0.54) * s);
      }
    }
  }

  // ---------- view
  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const oldW = this.cssW, oldH = this.cssH;
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = r.width; this.cssH = r.height;
    this.canvas.width = Math.round(r.width * this.dpr); this.canvas.height = Math.round(r.height * this.dpr);
    this.canvas.style.width = r.width + 'px'; this.canvas.style.height = r.height + 'px';
    if (!this.fitted) { this.fit(); this.fitted = true; }
    else { this.ox += (r.width - oldW) / 2; this.oy += (r.height - oldH) / 2; this.minScale = this.fitScale() * 0.6; this.clamp(); }
    this.requestDraw();
  }
  fitScale() { return Math.min((this.cssW - 24) / this.P.w, (this.cssH - 24) / this.P.h); }
  fit() {
    this.scale = this.fitScale();
    this.minScale = this.scale * 0.6;
    this.ox = (this.cssW - this.P.w * this.scale) / 2;
    this.oy = (this.cssH - this.P.h * this.scale) / 2;
    this.requestDraw();
  }
  zoomAt(px, py, newScale) {
    newScale = Math.max(this.minScale, Math.min(MAX_CELL, newScale));
    const gx = (px - this.ox) / this.scale, gy = (py - this.oy) / this.scale;
    this.scale = newScale;
    this.ox = px - gx * newScale; this.oy = py - gy * newScale;
    this.clamp(); this.requestDraw();
  }
  // keep at least a corner of the picture on screen
  clamp() {
    const w = this.P.w * this.scale, h = this.P.h * this.scale, m = 60;
    this.ox = Math.min(this.cssW - m, Math.max(m - w, this.ox));
    this.oy = Math.min(this.cssH - m, Math.max(m - h, this.oy));
  }
  zoomBy(f) { this.zoomAt(this.cssW / 2, this.cssH / 2, this.scale * f); }
  /** Zoom to where cells of the selected colour still wait. */
  findNext() {
    const { P } = this;
    let best = -1, bd = Infinity;
    const cx = (this.cssW / 2 - this.ox) / this.scale, cy = (this.cssH / 2 - this.oy) / this.scale;
    for (let i = 0; i < P.n; i++) {
      if (P.target[i] !== this.selected || this.filled[i]) continue;
      const x = i % P.w + 0.5, y = Math.floor(i / P.w) + 0.5, d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return false;
    const s = Math.max(this.scale, Math.min(28, MAX_CELL));
    const x = best % P.w + 0.5, y = Math.floor(best / P.w) + 0.5;
    this.scale = s; this.ox = this.cssW / 2 - x * s; this.oy = this.cssH / 2 - y * s;
    this.clamp(); this.requestDraw();
    this.flash(best);
    return true;
  }
  flash(i) {
    const P = this.P, x = i % P.w, y = Math.floor(i / P.w);
    let n = 0;
    const tick = () => {
      if (this.dead) return;
      this.draw();
      if (n++ > 18) return;
      const s = this.scale, a = 0.5 + 0.5 * Math.sin(n / 2);
      this.ctx.strokeStyle = `rgba(255, 79, 163, ${a})`; this.ctx.lineWidth = 3;
      this.ctx.strokeRect(this.ox + x * s - 3, this.oy + y * s - 3, s + 6, s + 6);
      requestAnimationFrame(tick);
    };
    tick();
  }

  select(ci) { this.selected = ci; this.paintBase(); this.requestDraw(); }

  // ---------- filling
  cellAt(px, py) {
    const x = Math.floor((px - this.ox) / this.scale), y = Math.floor((py - this.oy) / this.scale);
    if (x < 0 || y < 0 || x >= this.P.w || y >= this.P.h) return -1;
    return y * this.P.w + x;
  }
  fillCell(i) {
    if (i < 0 || this.filled[i]) return false;
    const t = this.P.target[i];
    if (t !== this.selected) return false;
    this.filled[i] = 1; this.remaining[t]--; this.done++;
    this.paintCell(i);
    if (this.stroke) this.stroke.push(i);
    return true;
  }
  // fill every cell along the line between two screen points, so fast
  // drags leave no gaps
  fillLine(ax, ay, bx, by) {
    const s = this.scale, steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (s * 0.5)));
    let changed = false;
    for (let k = 0; k <= steps; k++) changed = this.fillCell(this.cellAt(ax + (bx - ax) * k / steps, ay + (by - ay) * k / steps)) || changed;
    if (changed) { this.bctx.putImageData(this.bimg, 0, 0); this.requestDraw(); this.hooks.onChange?.(); this.hooks.onPop?.(); }
  }
  setCells(cells, value) {
    for (const i of cells) {
      if (this.filled[i] === value) continue;
      this.filled[i] = value;
      const t = this.P.target[i];
      this.remaining[t] += value ? -1 : 1; this.done += value ? 1 : -1;
      this.paintCell(i);
    }
    this.bctx.putImageData(this.bimg, 0, 0); this.requestDraw();
  }
  // ---------- tap-to-fill a patch
  // Every unfilled cell of the selected colour touching cell i (sides only),
  // in rings outward from it, so it can be revealed as a ripple.
  patch(i) {
    const { P } = this, t = P.target[i], seen = new Uint8Array(P.n), rings = [];
    let ring = [i]; seen[i] = 1;
    while (ring.length) {
      rings.push(ring);
      const next = [];
      for (const c of ring) {
        const x = c % P.w, y = (c - x) / P.w;
        const nb = [x > 0 ? c - 1 : -1, x < P.w - 1 ? c + 1 : -1, y > 0 ? c - P.w : -1, y < P.h - 1 ? c + P.w : -1];
        for (const d of nb) if (d >= 0 && !seen[d] && P.target[d] === t && !this.filled[d]) { seen[d] = 1; next.push(d); }
      }
      ring = next;
    }
    return rings;
  }
  bucket(i) {
    const rings = this.patch(i).slice(1); // the tapped cell is already filled
    if (!rings.length) { this.endStroke(); return; }
    const total = rings.reduce((a, r) => a + r.length, 0);
    const perFrame = Math.max(1, Math.ceil(rings.length / 16)); // the ripple lasts about a quarter second
    const x = i % this.P.w, y = Math.floor(i / this.P.w);
    this.hooks.onBucket?.(total, this.ox + (x + 0.5) * this.scale, this.oy + (y + 0.5) * this.scale);
    let k = 0;
    const step = () => {
      if (this.dead) return;
      for (let n = 0; n < perFrame && k < rings.length; n++, k++) for (const c of rings[k]) this.fillCell(c);
      this.bctx.putImageData(this.bimg, 0, 0); this.draw(); this.hooks.onChange?.();
      if (k < rings.length) this.anim = requestAnimationFrame(step);
      else { this.anim = 0; this.endStroke(); }
    };
    this.finishAnim = () => {
      cancelAnimationFrame(this.anim); this.anim = 0;
      for (; k < rings.length; k++) for (const c of rings[k]) this.fillCell(c);
      this.bctx.putImageData(this.bimg, 0, 0); this.requestDraw(); this.hooks.onChange?.();
      this.endStroke();
    };
    this.anim = requestAnimationFrame(step);
  }

  endStroke() {
    const s = this.stroke; this.stroke = null;
    if (!s || !s.length) return;
    this.undoStack.push(s); this.redoStack = [];
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.hooks.onStroke?.(s);
  }
  cancelStroke() {
    if (this.stroke && this.stroke.length) this.setCells(this.stroke, 0);
    this.stroke = null; this.hooks.onChange?.();
  }
  undo() {
    const s = this.undoStack.pop(); if (!s) return false;
    this.setCells(s, 0); this.redoStack.push(s); this.hooks.onStroke?.(s, 'undo'); return true;
  }
  redo() {
    const s = this.redoStack.pop(); if (!s) return false;
    this.setCells(s, 1); this.undoStack.push(s); this.hooks.onStroke?.(s, 'redo'); return true;
  }

  // ---------- input
  local(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  onPointerDown(e) {
    e.preventDefault();
    if (this.anim) this.finishAnim(); // a ripple still running: finish it now
    this.hooks.onTouch?.();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already-gone pointer */ }
    const [x, y] = this.local(e);
    this.pointers.set(e.pointerId, { x, y, type: e.pointerType });
    if (e.pointerType === 'mouse' && e.button !== 0) { this.mode = 'pan'; this.last = [x, y]; return; }
    if (this.pointers.size === 1) {
      if (this.finishedView) { this.mode = 'pan'; this.last = [x, y]; return; }
      this.mode = 'paint'; this.stroke = []; this.strokeAt = performance.now(); this.last = [x, y];
      this.downCell = this.cellAt(x, y); this.moved = false;
      this.fillLine(x, y, x, y);
      if (!this.stroke.length && this.P.target[this.cellAt(x, y)] >= 0 && !this.filled[this.cellAt(x, y)]) this.hooks.onMiss?.(this.P.target[this.cellAt(x, y)]);
    } else if (this.pointers.size === 2) {
      // second finger: this is a pinch. Undo a fill that only just started.
      if (this.mode === 'paint') {
        if (performance.now() - this.strokeAt < CANCEL_STROKE_MS || this.stroke.length <= 2) this.cancelStroke(); else this.endStroke();
      }
      this.mode = 'gesture'; this.startGesture();
    }
  }
  startGesture() {
    const [a, b] = [...this.pointers.values()];
    this.g = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, scale: this.scale, ox: this.ox, oy: this.oy };
  }
  onPointerMove(e) {
    const p = this.pointers.get(e.pointerId); if (!p) return;
    const [x, y] = this.local(e); p.x = x; p.y = y;
    if (this.mode === 'paint') {
      if (this.cellAt(x, y) !== this.downCell) this.moved = true;
      // coalesced events give the Pencil's full path between frames
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (evs.length > 1) for (const c of evs) { const [cx, cy] = this.local(c); this.fillLine(this.last[0], this.last[1], cx, cy); this.last = [cx, cy]; }
      else { this.fillLine(this.last[0], this.last[1], x, y); this.last = [x, y]; }
    } else if (this.mode === 'pan') {
      this.ox += x - this.last[0]; this.oy += y - this.last[1]; this.last = [x, y]; this.clamp(); this.requestDraw();
    } else if (this.mode === 'gesture' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()], g = this.g;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const s = Math.max(this.minScale, Math.min(MAX_CELL, g.scale * d / g.d));
      const gx = (g.mx - g.ox) / g.scale, gy = (g.my - g.oy) / g.scale; // grid point under the first midpoint
      this.scale = s; this.ox = mx - gx * s; this.oy = my - gy * s;
      this.clamp(); this.requestDraw();
    }
  }
  onPointerUp(e) {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.mode === 'paint' && this.pointers.size === 0) {
      this.mode = 'none';
      // a tap (no drag) on a cell that took the colour: fill its whole patch
      if (!this.moved && this.stroke && this.stroke.length === 1) this.bucket(this.stroke[0]);
      else this.endStroke();
    }
    else if (this.mode === 'gesture') {
      // lifting one finger of a pinch must not start painting with the other
      if (this.pointers.size === 0) this.mode = 'none'; else this.mode = 'wait';
    } else if (this.pointers.size === 0) this.mode = 'none';
  }
  onWheel(e) {
    e.preventDefault();
    const [x, y] = this.local(e);
    const wheelNotch = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50);
    if (e.ctrlKey) this.zoomAt(x, y, this.scale * Math.exp(-e.deltaY * 0.01));      // trackpad pinch
    else if (wheelNotch) this.zoomAt(x, y, this.scale * Math.exp(-Math.sign(e.deltaY) * 0.2)); // mouse wheel
    else { this.ox -= e.deltaX; this.oy -= e.deltaY; this.clamp(); this.requestDraw(); }  // trackpad pan
  }

  /** A PNG of the picture as it stands now (white where not yet coloured). */
  toPNG(maxSide = 2048) {
    const { P } = this, px = Math.max(1, Math.floor(maxSide / Math.max(P.w, P.h)));
    const c = document.createElement('canvas'); c.width = P.w * px; c.height = P.h * px;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < P.n; i++) {
      const t = P.target[i]; if (t < 0 || !this.filled[i]) continue;
      ctx.fillStyle = `rgb(${P.rgb[t].join(',')})`;
      ctx.fillRect((i % P.w) * px, Math.floor(i / P.w) * px, px, px);
    }
    return c;
  }
}
