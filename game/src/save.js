// Save — localStorage, key solmar-bay-save-v1, with a .bak fallback copy
// and defensive parsing (a corrupt save must never break boot).

export const SAVE_KEY = 'solmar-bay-save-v1';
const BAK_KEY = `${SAVE_KEY}.bak`;

function storage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch (e) { /* storage unavailable (private mode, SSR) */ }
  return null;
}

function parseDefensive(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch (e) {
    return null;
  }
}

function normalize(obj) {
  return {
    money: typeof obj.money === 'number' ? obj.money : 0,
    missionIndex: typeof obj.missionIndex === 'number' ? obj.missionIndex : 0,
    stats: {
      missionsDone: typeof obj.stats?.missionsDone === 'number' ? obj.stats.missionsDone : 0,
      carsStolen: typeof obj.stats?.carsStolen === 'number' ? obj.stats.carsStolen : 0,
      busted: typeof obj.stats?.busted === 'number' ? obj.stats.busted : 0,
      bestCash: typeof obj.stats?.bestCash === 'number' ? obj.stats.bestCash : 0,
    },
    muted: !!obj.muted,
  };
}

export function loadSave() {
  const store = storage();
  if (!store) return null;
  let raw = null;
  try { raw = store.getItem(SAVE_KEY); } catch (e) { return null; }
  let parsed = parseDefensive(raw);
  if (!parsed) {
    // Fall back to the backup copy.
    try { raw = store.getItem(BAK_KEY); } catch (e) { raw = null; }
    parsed = parseDefensive(raw);
    if (!parsed) return null;
  }
  return normalize(parsed);
}

export function saveGame(S) {
  const store = storage();
  if (!store) return false;
  const player = S.player || {};
  const money = typeof player.money === 'number' ? player.money : (typeof S.money === 'number' ? S.money : 0);
  const stats = (S.save && S.save.stats) || {};
  const data = normalize({
    money,
    missionIndex: S.missions ? S.missions.index : 0,
    stats: {
      missionsDone: stats.missionsDone || 0,
      carsStolen: stats.carsStolen || 0,
      busted: stats.busted || 0,
      bestCash: Math.max(stats.bestCash || 0, money),
    },
    muted: !!(S.audio && S.audio.muted),
  });
  try {
    const prev = store.getItem(SAVE_KEY);
    if (prev) {
      try { store.setItem(BAK_KEY, prev); } catch (e) { /* backup best-effort */ }
    }
    store.setItem(SAVE_KEY, JSON.stringify(data));
    if (!S.save) S.save = {};
    S.save.stats = data.stats;
    S.save.data = data;
    return true;
  } catch (e) {
    return false;
  }
}

export function clearSave() {
  const store = storage();
  if (!store) return;
  try { store.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  try { store.removeItem(BAK_KEY); } catch (e) { /* ignore */ }
}
