// save.js — Solmar Bay save/load (localStorage).
// Pure factory over the shared game context G. No DOM, no THREE, no imports,
// so it can be unit-tested in Node. Storage key per DESIGN.md:
//   solmar-bay-save-v1  (+ '.bak' fallback key)
//
// Shape stored:
//   { v: 1, money, missionIndex, stats: { missionsDone, carsStolen, busted,
//     bestCash }, muted, savedAt }
//
// The module never throws: every storage access is wrapped, because
// localStorage can be unavailable (private mode, file://, quota).

export const SAVE_KEY = 'solmar-bay-save-v1';
export const SAVE_BAK_KEY = 'solmar-bay-save-v1.bak';
export const SAVE_VERSION = 1;

export function defaultSaveData() {
  return {
    v: SAVE_VERSION,
    money: 150,
    missionIndex: 0,
    stats: { missionsDone: 0, carsStolen: 0, busted: 0, bestCash: 150 },
    muted: false,
    savedAt: 0,
  };
}

// Defensive parse: returns a valid save object or null. Never throws.
export function parseSave(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_err) {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.v !== SAVE_VERSION) return null;
  const out = defaultSaveData();
  if (typeof data.money === 'number' && Number.isFinite(data.money)) {
    out.money = Math.max(0, Math.floor(data.money));
  }
  if (typeof data.missionIndex === 'number' && Number.isFinite(data.missionIndex)) {
    out.missionIndex = Math.max(0, Math.min(3, Math.floor(data.missionIndex)));
  }
  if (data.stats && typeof data.stats === 'object') {
    for (const key of ['missionsDone', 'carsStolen', 'busted', 'bestCash']) {
      const val = data.stats[key];
      if (typeof val === 'number' && Number.isFinite(val)) {
        out.stats[key] = Math.max(0, Math.floor(val));
      }
    }
  }
  if (typeof data.muted === 'boolean') out.muted = data.muted;
  if (typeof data.savedAt === 'number' && Number.isFinite(data.savedAt)) {
    out.savedAt = data.savedAt;
  }
  return out;
}

export function createSave(G) {
  const store = (() => {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (_err) { /* storage unavailable */ }
    return null;
  })();

  // In-memory fallback so save/load still "work" (per session) when
  // localStorage is unavailable instead of crashing the game.
  const memory = { main: null, bak: null };

  function readRaw(key) {
    if (store) {
      try {
        return store.getItem(key);
      } catch (_err) {
        return null;
      }
    }
    return key === SAVE_KEY ? memory.main : memory.bak;
  }

  function writeRaw(key, value) {
    if (store) {
      try {
        store.setItem(key, value);
        return true;
      } catch (_err) {
        return false;
      }
    }
    if (key === SAVE_KEY) memory.main = value;
    else memory.bak = value;
    return true;
  }

  function snapshot() {
    const stats = (G && G.stats) || {};
    return {
      v: SAVE_VERSION,
      money: Math.max(0, Math.floor((G && G.money) || 0)),
      missionIndex: Math.max(0, Math.min(3, Math.floor((G && G.missionIndex) || 0))),
      stats: {
        missionsDone: Math.max(0, Math.floor(stats.missionsDone || 0)),
        carsStolen: Math.max(0, Math.floor(stats.carsStolen || 0)),
        busted: Math.max(0, Math.floor(stats.busted || 0)),
        bestCash: Math.max(0, Math.floor(stats.bestCash || 0)),
      },
      muted: !!(G && G.muted),
      savedAt: Date.now(),
    };
  }

  function apply(data) {
    if (!G || !data) return false;
    G.money = data.money;
    G.missionIndex = data.missionIndex;
    G.stats = {
      missionsDone: data.stats.missionsDone,
      carsStolen: data.stats.carsStolen,
      busted: data.stats.busted,
      bestCash: data.stats.bestCash,
    };
    G.muted = data.muted;
    return true;
  }

  const api = {
    key: SAVE_KEY,

    // Write current game state. Rotates the previous main slot into .bak
    // first, so a torn write never loses the last good save.
    save() {
      const data = snapshot();
      let raw;
      try {
        raw = JSON.stringify(data);
      } catch (_err) {
        return false;
      }
      const prev = readRaw(SAVE_KEY);
      if (prev) writeRaw(SAVE_BAK_KEY, prev);
      const ok = writeRaw(SAVE_KEY, raw);
      if (ok && G) G.lastSavedAt = data.savedAt;
      return ok;
    },

    // Load into G. Tries main, then .bak. Returns the loaded data or null.
    load() {
      const main = parseSave(readRaw(SAVE_KEY));
      if (main) {
        apply(main);
        return main;
      }
      const bak = parseSave(readRaw(SAVE_BAK_KEY));
      if (bak) {
        apply(bak);
        return bak;
      }
      return null;
    },

    // Peek without touching G. Used by the title screen ("Continue").
    peek() {
      return parseSave(readRaw(SAVE_KEY)) || parseSave(readRaw(SAVE_BAK_KEY));
    },

    hasSave() {
      return api.peek() !== null;
    },

    clear() {
      if (store) {
        try {
          store.removeItem(SAVE_KEY);
          store.removeItem(SAVE_BAK_KEY);
        } catch (_err) { /* ignore */ }
      }
      memory.main = null;
      memory.bak = null;
      return true;
    },

    snapshot,
    apply,
  };

  return api;
}
