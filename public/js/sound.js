// Ses ayarlari: muzik, efektler (zar vb.) ve sesli sohbet icin ayri ses duzeyi ve sessize alma.
// Her oyuncunun kendi tarayicisinda saklanir.
const KEY = "sanalmasa.sesayar";

const state = {
  music: 0.5, fx: 0.8, voice: 1,
  musicMuted: false, fxMuted: false, voiceMuted: false,
};
try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { /* yok */ }

const listeners = new Set();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* yok */ }
  listeners.forEach((fn) => fn());
}

export const soundSettings = {
  /** Gercek calma duzeyi (sessizse 0) */
  level(kind) { return state[kind + "Muted"] ? 0 : state[kind]; },
  value(kind) { return state[kind]; },
  muted(kind) { return state[kind + "Muted"]; },
  set(kind, v) {
    state[kind] = Math.max(0, Math.min(1, v));
    if (v > 0) state[kind + "Muted"] = false;
    save();
  },
  toggle(kind) {
    state[kind + "Muted"] = !state[kind + "Muted"];
    save();
  },
  onChange(fn) { listeners.add(fn); },
};
