// "Make one from my photos": pick a photo, crop it, choose how big and how
// many colours, see a preview, then colour it.
//
// Everything happens in this page, on the iPad. The photo is read from the
// file picker into memory, shrunk, and turned into a grid of numbers. Only
// that grid is kept (in this browser's storage). The photo itself is never
// saved and never sent anywhere: there is no server to send it to.
import { quantise, boost } from './quantise.js';
import { prepare, drawThumb } from './board.js';

const $ = sel => document.querySelector(sel);
const SIZES = [64, 80, 96, 112, 128];
const MAX_SIDE = 1600; // photos are shrunk to this before cropping

let img = null;          // a canvas holding the (shrunk) photo
let crop = null;         // { x, y, w, h } in img pixels
let view = null;         // how img is drawn in the crop canvas
let drag = null;
let settings = { size: 96, colors: 20 };
let result = null;       // { grid, pal, w, h }
let timer = 0;
let onDone = null;

export function initMaker(done) {
  onDone = done;
  $('#make-file').addEventListener('change', e => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ''; });
  $('#make-sizes').replaceChildren(...SIZES.map(s => {
    const b = document.createElement('button');
    b.className = 'pill'; b.textContent = s; b.dataset.size = s;
    b.onclick = () => { settings.size = s; markSize(); schedule(); };
    return b;
  }));
  markSize();
  const range = $('#make-colors');
  range.oninput = () => { settings.colors = +range.value; $('#make-colors-n').textContent = range.value; schedule(); };
  $('#make-start').onclick = start;
  const cv = $('#make-crop');
  cv.addEventListener('pointerdown', down);
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  new ResizeObserver(() => { if (img) layout(); }).observe(cv.parentElement);
}

/** Show the maker, starting from "pick a photo". */
export function showMaker() {
  document.body.dataset.view = 'make';
  document.title = 'make a picture ♡';
  if (!img) { $('#make-step2').hidden = true; $('#make-step1').hidden = false; }
}

function markSize() {
  for (const b of document.querySelectorAll('#make-sizes .pill')) b.classList.toggle('on', +b.dataset.size === settings.size);
}

async function loadFile(file) {
  $('#make-status').textContent = 'opening your photo…';
  let source;
  try {
    // modern Safari applies the photo's rotation for us
    source = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  } catch {
    source = await new Promise((res, rej) => {
      const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file);
    }).catch(() => null);
  }
  if (!source) { $('#make-status').textContent = "hmm, that photo wouldn't open. try another one?"; return; }
  const k = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
  img = document.createElement('canvas');
  img.width = Math.round(source.width * k); img.height = Math.round(source.height * k);
  const ctx = img.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, img.width, img.height);
  if (source.close) source.close();
  if (source.src) URL.revokeObjectURL(source.src);
  // start with the middle square-ish part
  const s = Math.min(img.width, img.height) * 0.9;
  crop = { x: (img.width - s) / 2, y: (img.height - s) / 2, w: s, h: s };
  $('#make-status').textContent = '';
  $('#make-step1').hidden = true; $('#make-step2').hidden = false;
  $('#make-name').value = '';
  layout();
  schedule(0);
}

// ---------------------------------------------------------------- cropping
function layout() {
  const cv = $('#make-crop'), box = cv.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (!box.width) return;
  const scale = Math.min(box.width / img.width, box.height / img.height);
  view = { scale, ox: (box.width - img.width * scale) / 2, oy: (box.height - img.height * scale) / 2, dpr, w: box.width, h: box.height };
  cv.width = Math.round(box.width * dpr); cv.height = Math.round(box.height * dpr);
  cv.style.width = box.width + 'px'; cv.style.height = box.height + 'px';
  drawCrop();
}

function drawCrop() {
  const cv = $('#make-crop'), ctx = cv.getContext('2d'), { scale, ox, oy, dpr } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, view.w, view.h);
  ctx.drawImage(img, ox, oy, img.width * scale, img.height * scale);
  const x = ox + crop.x * scale, y = oy + crop.y * scale, w = crop.w * scale, h = crop.h * scale;
  ctx.fillStyle = 'rgba(59, 31, 51, 0.55)';
  ctx.beginPath();
  ctx.rect(ox, oy, img.width * scale, img.height * scale);
  ctx.rect(x, y + h, w, -h); // a hole (opposite winding)
  ctx.fill('evenodd');
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
  ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
  ctx.fillStyle = '#FF4FA3'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
  for (const [cx, cy] of corners(x, y, w, h)) { ctx.beginPath(); ctx.arc(cx, cy, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
}
function corners(x, y, w, h) { return [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]; }

function local(e) { const r = $('#make-crop').getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function down(e) {
  if (!img) return;
  e.preventDefault();
  try { e.target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  const [px, py] = local(e), { scale, ox, oy } = view;
  const x = ox + crop.x * scale, y = oy + crop.y * scale, w = crop.w * scale, h = crop.h * scale;
  const hit = corners(x, y, w, h).findIndex(([cx, cy]) => Math.hypot(px - cx, py - cy) < 30);
  if (hit >= 0) drag = { kind: 'corner', corner: hit, start: [px, py], crop: { ...crop } };
  else if (px > x && px < x + w && py > y && py < y + h) drag = { kind: 'move', start: [px, py], crop: { ...crop } };
  else drag = null;
}
function move(e) {
  if (!drag) return;
  const [px, py] = local(e), dx = (px - drag.start[0]) / view.scale, dy = (py - drag.start[1]) / view.scale;
  const c = drag.crop, MIN = 24;
  if (drag.kind === 'move') {
    crop.x = clamp(c.x + dx, 0, img.width - c.w); crop.y = clamp(c.y + dy, 0, img.height - c.h);
  } else {
    let x0 = c.x, y0 = c.y, x1 = c.x + c.w, y1 = c.y + c.h;
    if (drag.corner === 0 || drag.corner === 2) x0 = clamp(x0 + dx, 0, x1 - MIN); else x1 = clamp(x1 + dx, x0 + MIN, img.width);
    if (drag.corner === 0 || drag.corner === 1) y0 = clamp(y0 + dy, 0, y1 - MIN); else y1 = clamp(y1 + dy, y0 + MIN, img.height);
    crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  drawCrop();
  schedule(250);
}
function up() { if (drag) { drag = null; schedule(0); } }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------- making the picture
function schedule(ms = 120) {
  clearTimeout(timer);
  $('#make-start').disabled = true;
  timer = setTimeout(makePreview, ms);
}

function makePreview() {
  if (!img || !crop) return;
  const long = Math.max(crop.w, crop.h);
  const gw = Math.max(4, Math.round(settings.size * crop.w / long)), gh = Math.max(4, Math.round(settings.size * crop.h / long));
  // shrink in halving steps: one big jump down makes a speckly, aliased image
  let src = img, sx = crop.x, sy = crop.y, sw = crop.w, sh = crop.h;
  while (sw > gw * 2 && sh > gh * 2) {
    const c = document.createElement('canvas');
    c.width = Math.max(gw, Math.round(sw / 2)); c.height = Math.max(gh, Math.round(sh / 2));
    const cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high';
    cx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
    src = c; sx = 0; sy = 0; sw = c.width; sh = c.height;
  }
  const out = document.createElement('canvas'); out.width = gw; out.height = gh;
  const octx = out.getContext('2d', { willReadFrequently: true }); octx.imageSmoothingQuality = 'high';
  octx.drawImage(src, sx, sy, sw, sh, 0, 0, gw, gh);
  const data = octx.getImageData(0, 0, gw, gh).data;
  boost(data, 1.2);
  const { grid, pal } = quantise(data, gw, gh, { colors: settings.colors, smooth: 0, clean: 1 });
  result = { grid, pal, w: gw, h: gh };
  const prev = $('#make-preview');
  prev.width = 600;
  drawThumb(prev, prepare({ ...result }), new Uint8Array(gw * gh).fill(1));
  $('#make-info').textContent = `${gw} × ${gh} · ${pal.length} colours`;
  $('#make-start').disabled = false;
}

function start() {
  if (!result) return;
  const name = ($('#make-name').value || '').trim().slice(0, 40) || 'my picture';
  const pic = {
    slug: 'mine-' + Date.now().toString(36),
    name, w: result.w, h: result.h, tags: ['mine'],
    added: new Date().toISOString().slice(0, 19),
    credit: { source: 'my photo', author: null, licence: 'own' },
    pal: result.pal, grid: result.grid,
  };
  img = null; crop = null; result = null; // let the photo go
  onDone?.(pic);
}
