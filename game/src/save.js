// save.js — Solmar Bay localStorage save/load (Worker B, v6 fresh)
// Contract: saveGame(G) / loadGame()
// Key 'solmar-bay-save-v1' + fallback '.bak'.
// {money, missionIndex, stats{missionsDone, carsStolen, busted, bestCash}, muted}
const KEY = 'solmar-bay-save-v1';

function safeStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch (e) {
    return null;
  }
}

function shape(data) {
  if (!data || typeof data !== 'object') return null;
  const out = {
    money: typeof data.money === 'number' ? Math.max(0, Math.floor(data.money)) : 150,
    missionIndex: typeof data.missionIndex === 'number'
      ? Math.max(0, Math.min(4, Math.floor(data.missionIndex))) : 0,
    stats: {
      missionsDone: 0, carsStolen: 0, busted: 0, bestCash: 0,
    },
    muted: !!data.muted,
  };
  if (data.stats && typeof data.stats === 'object') {
    for (const k of ['missionsDone', 'carsStolen', 'busted', 'bestCash']) {
      if (typeof data.stats[k] === 'number') out.stats[k] = Math.max(0, Math.floor(data.stats[k]));
    }
  }
  return out;
}

export function saveGame(G) {
  const ls = safeStorage();
  if (!ls) return false;
  const data = shape({
    money: G.state ? G.state.money : 150,
    missionIndex: G.state ? G.state.missionIndex : 0,
    stats: G.state ? G.state.stats : null,
    muted: G.state ? !!G.state.muted : false,
  });
  try {
    const json = JSON.stringify(data);
    // Keep the previous good copy as .bak before overwriting.
    try {
      const prev = ls.getItem(KEY);
      if (prev) ls.setItem(KEY + '.bak', prev);
    } catch (e) { /* ignore */ }
    ls.setItem(KEY, json);
    return true;
  } catch (e) {
    return false;
  }
}

export function loadGame() {
  const ls = safeStorage();
  if (!ls) return null;
  for (const k of [KEY, KEY + '.bak']) {
    try {
      const raw = ls.getItem(k);
      if (!raw) continue;
      const parsed = shape(JSON.parse(raw));
      if (parsed) return parsed;
    } catch (e) { /* corrupted entry — try the fallback */ }
  }
  return null;
}
