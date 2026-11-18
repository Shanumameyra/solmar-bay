// save.js — localStorage save/load, versioned, with a .bak fallback.
//
// Key: solmar-bay-save-v1 (+ '.bak'). Writes rotate the previous save to
// .bak first, so a crash mid-write never destroys progress. Loads try the
// .bak even when the primary parses as "newer" — a newer primary used to
// block the fallback outright. Defensive parse + validation throughout.

export const SAVE_KEY = 'solmar-bay-save-v1';
export const SAVE_VERSION = 1;

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (e) {
    return null;
  }
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function sanitize(d) {
  if (!d || typeof d !== 'object') return null;
  if (d.version !== SAVE_VERSION) return null;
  return {
    version: SAVE_VERSION,
    money: Math.max(0, num(d.money, 150)),
    missionIndex: Math.max(0, Math.min(3, Math.floor(num(d.missionIndex, 0)))),
    missionsDone: Math.max(0, Math.floor(num(d.missionsDone, 0))),
    carsStolen: Math.max(0, Math.floor(num(d.carsStolen, 0))),
    busted: Math.max(0, Math.floor(num(d.busted, 0))),
    deaths: Math.max(0, Math.floor(num(d.deaths, 0))),
    bestCash: Math.max(0, num(d.bestCash, 0)),
    muted: !!d.muted,
    seed: Math.floor(num(d.seed, 7)),
    savedAt: num(d.savedAt, 0),
  };
}

// Parse one raw slot: {data} when it is a valid v1 save, {newer:true}
// when it parses but comes from a newer build, null otherwise.
function parseSlot(raw) {
  if (raw == null) return null;
  let d;
  try {
    d = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (!d || typeof d !== 'object') return null;
  if (d.version > SAVE_VERSION) return { newer: true };
  const clean = sanitize(d);
  return clean ? { data: clean } : null;
}

export function captureSave(state) {
  const stats = state.stats || {};
  return {
    version: SAVE_VERSION,
    money: state.money ?? 150,
    missionIndex: state.mission?.index ?? 0,
    missionsDone: stats.missionsDone ?? 0,
    carsStolen: stats.carsStolen ?? 0,
    busted: stats.busted ?? 0,
    deaths: stats.deaths ?? 0,
    bestCash: Math.max(stats.bestCash ?? 0, state.money ?? 0),
    muted: !!state.muted,
    seed: state.seed ?? 7,
    savedAt: Date.now(),
  };
}

export function saveGame(state, storage) {
  const store = storage || defaultStorage();
  if (!store) return false;
  try {
    const data = captureSave(state);
    const prev = store.getItem(SAVE_KEY);
    if (prev != null) store.setItem(SAVE_KEY + '.bak', prev);
    store.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadSave(storage) {
  const store = storage || defaultStorage();
  if (!store) return { ok: false, empty: true };
  let raw = null;
  try {
    raw = store.getItem(SAVE_KEY);
  } catch (e) {
    raw = null;
  }
  const primary = parseSlot(raw);
  if (primary && primary.data) return { ok: true, data: primary.data };
  // Fall back to .bak — even when the primary is "newer".
  let bakRaw = null;
  try {
    bakRaw = store.getItem(SAVE_KEY + '.bak');
  } catch (e) {
    bakRaw = null;
  }
  const bak = parseSlot(bakRaw);
  if (bak && bak.data) return { ok: true, data: bak.data, fromBak: true };
  if ((primary && primary.newer) || (bak && bak.newer)) return { ok: false, newer: true };
  return { ok: false, empty: true };
}

export function hasSave(storage) {
  return loadSave(storage).ok;
}

export function clearSave(storage) {
  const store = storage || defaultStorage();
  if (!store) return false;
  try {
    store.removeItem(SAVE_KEY);
    store.removeItem(SAVE_KEY + '.bak');
    return true;
  } catch (e) {
    return false;
  }
}

// Apply a loaded save to live state (data only — no live references).
// Mission index is applied by main.js via missions.loadIndex().
export function applySave(state, data) {
  if (!data) return state;
  state.money = data.money;
  state.muted = !!data.muted;
  state.stats = state.stats || {};
  state.stats.missionsDone = data.missionsDone ?? 0;
  state.stats.carsStolen = data.carsStolen ?? 0;
  state.stats.busted = data.busted ?? 0;
  state.stats.deaths = data.deaths ?? 0;
  state.stats.bestCash = data.bestCash ?? 0;
  return state;
}
