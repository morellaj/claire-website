// Claire's colouring: the gallery and the colouring screen.
// Static pictures from ./pictures/, progress in this browser only (store.js).
import { Board, prepare, drawThumb, luminance } from './board.js';
import * as store from './store.js';
import { confetti, sparkleAt } from './fun.js';
import { initMaker, showMaker } from './maker.js';
import * as sound from './sound.js';

const $ = sel => document.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
};

let index = null;
const pictures = new Map(); // slug -> picture JSON
let board = null, current = null, saveTimer = 0;

async function loadIndex() {
  if (index) return index;
  const r = await fetch('/paint/pictures/index.json', { cache: 'no-cache' });
  index = await r.json();
  return index;
}
async function loadPicture(slug) {
  if (pictures.has(slug)) return pictures.get(slug);
  if (slug.startsWith('mine-')) {
    const p = store.loadMine(slug);
    if (!p) throw new Error('no such picture');
    pictures.set(slug, p);
    return p;
  }
  const r = await fetch(`/paint/pictures/${encodeURIComponent(slug)}.json`);
  if (!r.ok) throw new Error('no such picture');
  const p = await r.json();
  pictures.set(slug, p);
  return p;
}

// ---------------------------------------------------------------- gallery
const thumbObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    thumbObserver.unobserve(en.target);
    drawCardThumb(en.target);
  }
}, { rootMargin: '300px' }) : null;

async function drawCardThumb(canvas) {
  const slug = canvas.dataset.slug;
  try {
    const pic = await loadPicture(slug), P = prepare(pic);
    canvas.width = Math.round(180 * (window.devicePixelRatio || 1));
    drawThumb(canvas, P, store.loadFilled(slug, P.n));
  } catch { /* leave it blank */ }
}

// A picture can come in little / medium / big. The one she touched last is the
// one the card shows (its progress and its thumbnail).
function active(s) {
  const slugs = s.sizes ? s.sizes.map(v => v.slug) : [s.slug];
  let best = { slug: s.sizes ? s.sizes[s.sizes.length - 1].slug : s.slug, prog: null };
  for (const slug of slugs) {
    const p = store.summary(slug);
    if (p && p.done > 0 && (!best.prog || String(p.touched) > String(best.prog.touched))) best = { slug, prog: p };
  }
  return best;
}
const sizeOf = (w, h) => (w * h > 4000 ? 'big' : w * h > 1200 ? 'medium' : 'little');
const pctOf = p => (p && p.total ? Math.floor(100 * p.done / p.total) : 0);

function card(s) {
  const { slug, prog } = active(s);
  const pct = pctOf(prog);
  const thumb = el('canvas', { class: 'thumb', 'data-slug': slug, width: 10, height: 10 });
  const badge = prog && prog.finished ? el('span', { class: 'badge done' }, '✓ done')
    : pct > 0 ? el('span', { class: 'badge' }, pct + '%') : null;
  const meta = s.sizes ? 'little · medium · big' : `${sizeOf(s.w, s.h)} · ${s.colors} colours`;
  const c = el('a', {
    class: 'card', href: '#/p/' + s.slug,
    onclick: e => { if (s.sizes) { e.preventDefault(); showSizes(s); } },
  },
    el('div', { class: 'thumb-wrap' }, thumb, badge),
    el('div', { class: 'card-name' }, s.name),
    el('div', { class: 'card-meta' }, meta));
  if (s.slug.startsWith('mine-')) {
    c.querySelector('.thumb-wrap').append(el('button', {
      class: 'del', 'aria-label': 'delete this picture',
      onclick: e => {
        e.preventDefault(); e.stopPropagation();
        if (!confirm(`delete "${s.name}"? this can't be undone.`)) return;
        store.deleteMine(s.slug); pictures.delete(s.slug); showGallery();
      },
    }, '×'));
  }
  if (thumbObserver) thumbObserver.observe(thumb); else drawCardThumb(thumb);
  return c;
}

async function showGallery() {
  teardownBoard();
  document.body.dataset.view = 'gallery';
  document.title = "claire's colouring ♡";
  const list = $('#gallery-list');
  list.replaceChildren(el('p', { class: 'loading' }, 'loading pictures…'));
  let idx;
  try { idx = await loadIndex(); } catch {
    list.replaceChildren(el('p', { class: 'loading' }, "couldn't load the pictures — are you online?"));
    return;
  }
  const going = [], fresh = [], done = [];
  for (const s of [...store.mineList(), ...idx.pictures]) {
    const p = active(s).prog;
    if (p && p.finished) done.push([s, p]); else if (p && p.done > 0) going.push([s, p]); else fresh.push([s, p]);
  }
  going.sort((a, b) => String(b[1].touched).localeCompare(String(a[1].touched)));
  done.sort((a, b) => String(b[1].finished).localeCompare(String(a[1].finished)));
  const section = (id, title, items) => items.length ? el('section', { class: 'shelf', id: 'shelf-' + id },
    el('h2', {}, title), el('div', { class: 'cards' }, ...items.map(([s]) => card(s)))) : null;
  // pictures not started yet go on a shelf per kind, picked by the first tag
  const byShelf = new Map(SHELVES.map(([id]) => [id, []]));
  for (const item of fresh) {
    const id = byShelf.has(item[0].tags?.[0]) ? item[0].tags[0] : 'more';
    byShelf.get(id).push(item);
  }
  const shelves = SHELVES.map(([id, title]) => section(id, title, byShelf.get(id))).filter(Boolean);
  const jump = el('nav', { class: 'jump' }, ...[
    ...(going.length ? [['going', 'keep going']] : []),
    ...SHELVES.filter(([id]) => byShelf.get(id).length).map(([id, title]) => [id, title]),
    ...(done.length ? [['done', 'finished']] : []),
  ].map(([id, title]) => el('button', { onclick: () => document.getElementById('shelf-' + id)?.scrollIntoView({ behavior: 'smooth' }) }, title)));
  const make = el('a', { class: 'make-btn', href: '#/make' }, '📷 make one from my photos');
  list.replaceChildren(...[
    make,
    jump,
    section('going', 'keep going ✨', going),
    ...shelves,
    section('done', 'finished ♡', done),
  ].filter(Boolean));
  homeScreenTip();
}

// Gallery shelves, in order. A picture's first tag picks its shelf.
const SHELVES = [
  ['mine', 'my pictures 📷'],
  ['little-sister', 'little sister 🧸'],
  ['pets', 'pets 🐾'],
  ['animals', 'animals 🦋'],
  ['fashion', 'fashion 👗'],
  ['makeup', 'makeup 💄'],
  ['food', 'yummy 🧁'],
  ['nature', 'nature 🌸'],
  ['more', 'more ✨'],
];

// "which size?" when she taps a picture that comes in sizes
function showSizes(s) {
  const sheet = $('#sizes');
  $('#sizes-name').textContent = s.name;
  $('#sizes-list').replaceChildren(...s.sizes.map(v => {
    const p = store.summary(v.slug), pct = pctOf(p);
    const note = p && p.finished ? '✓ done' : pct > 0 ? pct + '% done' : '';
    return el('a', { class: 'size-btn', href: '#/p/' + v.slug, onclick: () => { sheet.hidden = true; } },
      el('span', { class: 'size-dot ' + v.size }),
      el('b', {}, v.size),
      el('span', { class: 'size-info' }, `${v.w} × ${v.h} · ${v.colors} colours`),
      note ? el('span', { class: 'size-note' }, note) : null);
  }));
  sheet.hidden = false;
}

function homeScreenTip() {
  const tip = $('#tip');
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  tip.hidden = standalone || store.pref('tipClosed') === true;
}

// ---------------------------------------------------------------- colouring
function teardownBoard() {
  if (board) { flushSave(); board.destroy(); board = null; current = null; }
  $('#finish').hidden = true;
}

async function showPicture(slug) {
  teardownBoard();
  document.body.dataset.view = 'colour';
  let pic;
  try { pic = await loadPicture(slug); } catch { location.hash = ''; return; }
  if (location.hash !== '#/p/' + slug || board) return; // she tapped away while it loaded
  const P = prepare(pic), filled = store.loadFilled(slug, P.n);
  current = { slug, pic, P };
  document.title = pic.name + ' ♡';
  $('#pic-name').textContent = pic.name;
  board = new Board($('#board'), P, filled, {
    onChange: () => updateStatus(),
    onStroke: (cells, how) => afterStroke(cells, how),
    onMiss: t => { nudgeChip(t); sound.boop(); },
    onTouch: () => sound.unlock(),
    onPop: () => sound.pop(),
    onBucket: (n, x, y) => {
      sound.swoosh(n);
      if (n >= 12) {
        const r = $('#board').getBoundingClientRect(), t = board.selected;
        sparkleAt(r.left + x, r.top + y, `rgb(${current.P.rgb[t].join(',')})`);
      }
    },
  });
  buildPalette();
  board.fitted = false; board.resize(); // fit again now the palette has its size
  const firstLeft = board.remaining.findIndex(r => r > 0);
  selectColour(firstLeft >= 0 ? firstLeft : 0);
  updateStatus();
  if (board.done === P.colourable) showFinished(false);
  store.askToPersist();
  window.paintDebug = { board, current }; // for poking at it from the console
}

function buildPalette() {
  const { P } = current;
  const chips = P.rgb.map((rgb, i) => {
    const dark = luminance(rgb) < 0.55;
    return el('button', {
      class: 'chip' + (dark ? ' dark' : ''), style: `--c: rgb(${rgb.join(',')})`, 'data-i': i,
      'aria-label': `colour ${i + 1}`,
      onclick: () => {
        if (board.selected === i && board.remaining[i] > 0) board.findNext();
        selectColour(i);
      },
    }, el('span', { class: 'num' }, String(i + 1)), el('span', { class: 'left' }));
  });
  $('#palette').replaceChildren(...chips);
  layoutPalette();
}

// Landscape puts the palette in columns down the right; size them to fit.
function layoutPalette() {
  const pal = $('#palette');
  if (!current || !pal) return;
  const n = current.P.rgb.length, chip = 54, gap = 10;
  const h = $('.stage').getBoundingClientRect().height - 28;
  const rows = Math.max(1, Math.floor((h + gap) / (chip + gap)));
  pal.style.setProperty('--rows', String(Math.min(rows, n)));
  pal.style.setProperty('--cols', String(Math.ceil(n / rows)));
}
addEventListener('resize', layoutPalette);

function selectColour(i) {
  board.select(i);
  for (const c of document.querySelectorAll('.chip')) c.classList.toggle('on', +c.dataset.i === i);
  const on = document.querySelector('.chip.on');
  on?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

function updateStatus() {
  if (!board) return;
  const { P } = current;
  $('#pct').textContent = Math.floor(100 * board.done / P.colourable) + '%';
  for (const c of document.querySelectorAll('.chip')) {
    const i = +c.dataset.i, left = board.remaining[i];
    c.classList.toggle('finished', left === 0);
    c.querySelector('.left').textContent = left === 0 ? '✓' : String(left);
  }
  $('#undo').disabled = !board.undoStack.length;
  $('#redo').disabled = !board.redoStack.length;
}

function nudgeChip(t) {
  const c = document.querySelector(`.chip[data-i="${t}"]`);
  if (!c) return;
  c.classList.remove('nudge'); void c.offsetWidth; c.classList.add('nudge');
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 250);
}
function flushSave() {
  clearTimeout(saveTimer);
  if (!board || !current) return;
  store.saveFilled(current.slug, board.filled, board.done, current.P.colourable);
}

function afterStroke(cells, how) {
  scheduleSave();
  updateStatus();
  const { P } = current;
  if (board.done < P.colourable) {
    if (board.finishedView) { board.finishedView = false; board.requestDraw(); $('#finish').hidden = true; }
    if (how) return;
    const t = board.selected;
    if (board.remaining[t] === 0) {
      // a colour is done: pop its chip and move on to the next one left
      const chip = document.querySelector(`.chip[data-i="${t}"]`);
      sound.chime();
      if (chip) { const r = chip.getBoundingClientRect(); sparkleAt(r.left + r.width / 2, r.top + r.height / 2, `rgb(${P.rgb[t].join(',')})`); }
      const order = [...P.rgb.keys()];
      const next = order.slice(t + 1).concat(order.slice(0, t)).find(i => board.remaining[i] > 0);
      if (next != null) selectColour(next);
    }
  } else if (!how || how === 'redo') {
    flushSave();
    showFinished(true);
  }
}

function showFinished(party) {
  const { P, pic } = current;
  board.finishedView = true;
  board.fit();
  const card = $('#finish');
  $('#finish-name').textContent = pic.name;
  const c = $('#finish-thumb'); c.width = 260 * (window.devicePixelRatio || 1);
  drawThumb(c, P, board.filled);
  card.hidden = false;
  if (party) { confetti(P.rgb.map(c => `rgb(${c.join(',')})`)); sound.fanfare(); }
}

// Save to Photos. iPad Safari opens the share sheet ("Save Image"); elsewhere
// it downloads. The PNG is made synchronously so the share still counts as
// part of the tap — Safari refuses navigator.share after an async gap.
function savePNG() {
  if (!board) return;
  const url = board.toPNG().toDataURL('image/png');
  const bin = atob(url.split(',')[1]), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const name = current.slug + '.png';
  const file = new File([bytes], name, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file] }).catch(() => {});
    return;
  }
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
}

// ---------------------------------------------------------------- wiring
function route() {
  const m = location.hash.match(/^#\/p\/([a-z0-9-]+)$/);
  if (m) showPicture(m[1]);
  else if (location.hash === '#/make') { teardownBoard(); showMaker(); }
  else showGallery();
}

// a picture made from her photo: keep it on this iPad and open it
function madePicture(pic) {
  let cells = 0;
  for (const row of pic.grid) for (const ch of row) if (ch !== '.') cells++;
  const summary = { slug: pic.slug, name: pic.name, w: pic.w, h: pic.h, colors: pic.pal.length, cells, tags: pic.tags };
  if (!store.saveMine(pic, summary)) {
    alert("there's no room left to save more pictures. delete one of your own pictures and try again.");
    location.hash = '#/';
    return;
  }
  pictures.set(pic.slug, pic);
  location.hash = '#/p/' + pic.slug;
}

function wire() {
  $('#undo').onclick = () => { board?.undo(); updateStatus(); };
  $('#redo').onclick = () => { board?.redo(); updateStatus(); };
  $('#zoom-in').onclick = () => board?.zoomBy(1.6);
  $('#zoom-out').onclick = () => board?.zoomBy(1 / 1.6);
  $('#fit').onclick = () => board?.fit();
  $('#find').onclick = () => board?.findNext();
  $('#save').onclick = savePNG;
  const muteBtn = $('#mute');
  const showMute = () => { muteBtn.textContent = sound.isMuted() ? '🔇' : '🔊'; };
  muteBtn.onclick = () => { sound.setMuted(!sound.isMuted()); sound.unlock(); showMute(); if (!sound.isMuted()) sound.pop(); };
  showMute();
  $('#finish-save').onclick = savePNG;
  $('#finish-close').onclick = () => { $('#finish').hidden = true; };
  $('#sizes-close').onclick = () => { $('#sizes').hidden = true; };
  $('#sizes').addEventListener('click', e => { if (e.target.id === 'sizes') $('#sizes').hidden = true; });
  $('#tip-close').onclick = () => { store.pref('tipClosed', true); $('#tip').hidden = true; };
  document.addEventListener('keydown', e => {
    if (!board) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? board.redo() : board.undo()); updateStatus(); }
    else if (e.key === '+' || e.key === '=') board.zoomBy(1.4);
    else if (e.key === '-') board.zoomBy(1 / 1.4);
  });
  // save when the page is hidden (app switch, lock, closing the tab)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
  addEventListener('pagehide', flushSave);
  addEventListener('hashchange', route);
}

wire();
initMaker(madePicture);
route();
