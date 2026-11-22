// Progress on this iPad, in localStorage. One small record per picture:
// which cells are filled (a bitset, base64), how many, and when it was finished.
// Nothing here ever leaves the device.

const PREFIX = 'paint.v1.';

function pack(filled) {
  const bytes = new Uint8Array(Math.ceil(filled.length / 8));
  for (let i = 0; i < filled.length; i++) if (filled[i]) bytes[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unpack(b64, n) {
  const out = new Uint8Array(n);
  if (!b64) return out;
  const s = atob(b64);
  for (let i = 0; i < n; i++) if (s.charCodeAt(i >> 3) & (1 << (i & 7))) out[i] = 1;
  return out;
}

function read(slug) {
  try { return JSON.parse(localStorage.getItem(PREFIX + slug)) || null; } catch { return null; }
}

/** Filled flags for every cell (row-major), restored from storage. */
export function loadFilled(slug, n) {
  const r = read(slug);
  return r && r.n === n ? unpack(r.bits, n) : new Uint8Array(n);
}

/** { done, total, finished } for the gallery, without unpacking. */
export function summary(slug) {
  const r = read(slug);
  return r ? { done: r.done || 0, total: r.total || 0, finished: r.finished || null, touched: r.touched || null } : null;
}

export function saveFilled(slug, filled, done, total) {
  const prev = read(slug);
  const rec = {
    n: filled.length, bits: pack(filled), done, total,
    finished: done === total ? (prev && prev.finished) || new Date().toISOString() : null,
    touched: new Date().toISOString(),
  };
  try {
    localStorage.setItem(PREFIX + slug, JSON.stringify(rec));
    return true;
  } catch (e) {
    console.warn('could not save progress', e);
    return false;
  }
}

export function forget(slug) { localStorage.removeItem(PREFIX + slug); }

export function pref(key, value) {
  const k = PREFIX + 'pref.' + key;
  if (value === undefined) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
  localStorage.setItem(k, JSON.stringify(value));
}

// Ask Safari not to clear our storage. Safari grants it mostly when the page
// runs from the Home Screen; in a normal tab it usually says no, and then the
// 7-days-of-Safari-use rule applies. Harmless to ask every launch.
export async function askToPersist() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}

// ---- her own pictures (made from her photos on this iPad). Only the grid of
// numbers is kept, never the photo.
const MINE = PREFIX + 'mine';

export function mineList() {
  try { return JSON.parse(localStorage.getItem(MINE)) || []; } catch { return []; }
}
export function loadMine(slug) {
  try { return JSON.parse(localStorage.getItem(MINE + '.' + slug)); } catch { return null; }
}
/** Returns false if the iPad's storage for this page is full. */
export function saveMine(pic, summary) {
  try {
    localStorage.setItem(MINE + '.' + pic.slug, JSON.stringify(pic));
    localStorage.setItem(MINE, JSON.stringify([summary, ...mineList().filter(s => s.slug !== pic.slug)]));
    return true;
  } catch (e) {
    localStorage.removeItem(MINE + '.' + pic.slug);
    console.warn('could not save picture', e);
    return false;
  }
}
export function deleteMine(slug) {
  localStorage.removeItem(MINE + '.' + slug);
  localStorage.setItem(MINE, JSON.stringify(mineList().filter(s => s.slug !== slug)));
  forget(slug);
}
