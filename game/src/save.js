// Solmar Bay — save system (Worker B).
// Plain-data JSON save in localStorage, versioned, with a .bak fallback.
// Save data, never objects: money, mission index, stats, settings, seed.
// Writes are "atomic enough" for localStorage: write the new save, keep the
// previous one as .bak, so a crash mid-write never destroys the last good save.

export const SAVE_KEY = 'solmar-bay-save-v1';
export const SAVE_VERSION = 1;

// Default storage: localStorage in the browser, an in-memory map in Node/tests.
function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch (e) { /* storage unavailable (private mode, sandbox) */ }
  const mem = new Map();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, v); },
    removeItem: (k) => { mem.delete(k); },
  };
}

export function captureSave(state) {
  const stats = state.stats || {};
  return {
    version: SAVE_VERSION,
    money: Math.max(0, Math.floor(state.money || 0)),
    missionIndex: (state.mission && state.mission.index) || 0,
    missionsDone: stats.missionsDone || 0,
    carsStolen: stats.carsStolen || 0,
    busted: stats.busted || 0,
    deaths: stats.deaths || 0,
    bestCash: stats.bestCash || 0,
    muted: !!(state.muted || (state.audioMuted === true)),
    seed: state.seed || 7,
    savedAt: Date.now(),
  };
}

export function saveGame(state, storage) {
  const store = storage || defaultStorage();
  let data;
  try {
    data = captureSave(state);
  } catch (e) {
    return { ok: false, error: 'capture failed: ' + e.message };
  }
  let json;
  try {
    json = JSON.stringify(data);
  } catch (e) {
    return { ok: false, error: 'stringify failed: ' + e.message };
  }
  try {
    const prev = store.getItem(SAVE_KEY);
    if (prev) store.setItem(SAVE_KEY + '.bak', prev);
    store.setItem(SAVE_KEY, json);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'write failed: ' + e.message };
  }
}

function parseSave(json) {
  if (!json || typeof json !== 'string') return null;
  let data;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const version = parseInt(data.version, 10);
  if (!Number.isFinite(version)) return null; // no version field: refuse
  if (version > SAVE_VERSION) return { newer: true, version };
  return migrate(data, version);
}

function migrate(data, version) {
  // v1 is the first schema; future versions migrate here step by step.
  void version;
  return {
    version: SAVE_VERSION,
    money: clampMoney(data.money),
    missionIndex: clampInt(data.missionIndex, 0, 3),
    missionsDone: clampInt(data.missionsDone, 0, 1e6),
    carsStolen: clampInt(data.carsStolen, 0, 1e6),
    busted: clampInt(data.busted, 0, 1e6),
    deaths: clampInt(data.deaths, 0, 1e6),
    bestCash: clampInt(data.bestCash, 0, 1e9),
    muted: data.muted === true,
    seed: clampInt(data.seed, 1, 1e9) || 7,
  };
}

function clampMoney(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(n, 1e9)) : 0;
}

function clampInt(v, lo, hi) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export function loadSave(storage) {
  const store = storage || defaultStorage();
  for (const key of [SAVE_KEY, SAVE_KEY + '.bak']) {
    let json = null;
    try {
      json = store.getItem(key);
    } catch (e) {
      continue;
    }
    const parsed = parseSave(json);
    if (parsed && !parsed.newer) return { ok: true, data: parsed, fromBak: key !== SAVE_KEY };
    if (parsed && parsed.newer) return { ok: false, newer: true, version: parsed.version };
  }
  return { ok: false, empty: true };
}

export function applySave(state, data) {
  if (!data) return;
  state.money = data.money;
  if (state.mission) state.mission.index = data.missionIndex;
  if (state.stats) {
    state.stats.missionsDone = data.missionsDone;
    state.stats.carsStolen = data.carsStolen;
    state.stats.busted = data.busted;
    state.stats.deaths = data.deaths;
    state.stats.bestCash = data.bestCash;
  }
  state.muted = data.muted;
  if (data.seed) state.seed = data.seed;
}

export function hasSave(storage) {
  const store = storage || defaultStorage();
  try {
    return !!(store.getItem(SAVE_KEY) || store.getItem(SAVE_KEY + '.bak'));
  } catch (e) {
    return false;
  }
}

export function clearSave(storage) {
  const store = storage || defaultStorage();
  try {
    store.removeItem(SAVE_KEY);
    store.removeItem(SAVE_KEY + '.bak');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
