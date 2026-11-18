// save.js — localStorage save for Solmara. Key "solmara-save-v1".
// Shape: { money:number, missionsDone:number[], packages:number[],
//          best:number, muted:boolean }.
// All functions are safe outside a browser (no-ops / defaults) and never
// throw: a corrupt or unavailable store just yields fresh defaults.
export const SAVE_KEY = 'solmara-save-v1';

export function defaultSave() {
  return { money: 0, missionsDone: [], packages: [], best: 0, muted: false };
}

function storage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    return null;
  }
  return null;
}

function sanitize(data) {
  const d = defaultSave();
  if (!data || typeof data !== 'object') return d;
  if (typeof data.money === 'number' && Number.isFinite(data.money)) {
    d.money = Math.max(0, Math.floor(data.money));
  }
  if (Array.isArray(data.missionsDone)) {
    d.missionsDone = [...new Set(data.missionsDone.filter((n) => Number.isInteger(n) && n >= 0 && n < 5))].sort((a, b) => a - b);
  }
  if (Array.isArray(data.packages)) {
    d.packages = [...new Set(data.packages.filter((n) => Number.isInteger(n) && n >= 0 && n < 10))].sort((a, b) => a - b);
  }
  if (typeof data.best === 'number' && Number.isFinite(data.best)) {
    d.best = Math.max(0, Math.floor(data.best));
  }
  if (typeof data.muted === 'boolean') d.muted = data.muted;
  return d;
}

export function loadSave() {
  const store = storage();
  if (!store) return defaultSave();
  let raw = null;
  try {
    raw = store.getItem(SAVE_KEY);
  } catch {
    return defaultSave();
  }
  if (!raw) return defaultSave();
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return defaultSave();
  }
}

export function saveSave(data) {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(SAVE_KEY, JSON.stringify(sanitize(data)));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}
