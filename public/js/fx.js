// Zar efektleri: donen zar, dogal 20 kutlamasi, dogal 1 felaketi.
// Tum sesler Web Audio ile uretilir, dis dosya gerekmez.
import { h } from "./util.js";
import { soundSettings } from "./sound.js";

let audio = null;

// Tarayicilar sesi ancak ilk tiklamadan sonra acar
function ac() {
  if (!audio) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audio = new Ctx();
  }
  if (audio.state === "suspended") audio.resume();
  return audio;
}
window.addEventListener("pointerdown", () => ac(), { once: true });


/* ================================================================ */
/* Ses sentezi                                                       */
/* ================================================================ */

function master(ctx, volume) {
  const comp = ctx.createDynamicsCompressor();
  const g = ctx.createGain();
  g.gain.value = volume * soundSettings.level("fx");
  g.connect(comp);
  comp.connect(ctx.destination);
  return g;
}

function tone(ctx, out, { type = "sine", freq, start, dur, vol = 0.3, slideTo, attack = 0.01 }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g);
  g.connect(out);
  o.start(start);
  o.stop(start + dur + 0.05);
  return o;
}

function noise(ctx, out, { start, dur, vol = 0.3, filter = "bandpass", from = 2000, to = 2000, q = 1 }) {
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(from, start);
  f.frequency.exponentialRampToValueAtTime(to, start + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(start);
}

const SOUNDS = {
  // Emoji tepkisi "pop"
  pop(ctx) {
    const out = master(ctx, 0.35);
    tone(ctx, out, { type: "sine", freq: 600, slideTo: 1200, start: ctx.currentTime, dur: 0.12, vol: 0.4 });
  },

  // Sira sende: iki vurus can
  turn(ctx) {
    const out = master(ctx, 0.5);
    const t = ctx.currentTime;
    for (const [f, at] of [[880, 0], [1318.5, 0.16]]) {
      tone(ctx, out, { type: "sine", freq: f, start: t + at, dur: 0.9, vol: 0.35 });
      tone(ctx, out, { type: "sine", freq: f * 2.01, start: t + at, dur: 0.5, vol: 0.08 });
    }
  },

  // Gorsel acildi: gizemli arp
  reveal(ctx) {
    const out = master(ctx, 0.4);
    const t = ctx.currentTime;
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(ctx, out, { type: "triangle", freq: f, start: t + i * 0.07, dur: 0.8, vol: 0.18 }));
  },

  // Masada yuvarlanan zar tikirtisi
  roll(ctx) {
    const out = master(ctx, 0.5);
    const t = ctx.currentTime;
    for (let i = 0; i < 9; i++) {
      const at = t + i * 0.075 + Math.random() * 0.03;
      noise(ctx, out, { start: at, dur: 0.05, vol: 0.5 - i * 0.04, from: 3000 + Math.random() * 2000, to: 1500, q: 4 });
    }
  },

  // Yere oturma "tok" sesi
  land(ctx) {
    const out = master(ctx, 0.6);
    tone(ctx, out, { type: "triangle", freq: 220, slideTo: 90, start: ctx.currentTime, dur: 0.18, vol: 0.5 });
  },

  // Dogal 20: zafer borusu + parilti
  crit(ctx) {
    const out = master(ctx, 0.55);
    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      tone(ctx, out, { type: "square", freq: f, start: t + i * 0.11, dur: 0.16, vol: 0.18 });
      tone(ctx, out, { type: "triangle", freq: f / 2, start: t + i * 0.11, dur: 0.16, vol: 0.2 });
    });
    const chordAt = t + notes.length * 0.11;
    for (const f of [523.25, 659.25, 783.99, 1046.5, 1318.5]) {
      tone(ctx, out, { type: "sawtooth", freq: f, start: chordAt, dur: 1.6, vol: 0.07, attack: 0.03 });
      tone(ctx, out, { type: "square", freq: f * 1.003, start: chordAt, dur: 1.6, vol: 0.05, attack: 0.03 });
    }
    tone(ctx, out, { type: "sine", freq: 65.4, start: chordAt, dur: 1.4, vol: 0.5 });
    for (let i = 0; i < 14; i++) {
      tone(ctx, out, { type: "sine", freq: 2000 + Math.random() * 3000, start: chordAt + 0.1 + i * 0.07, dur: 0.12, vol: 0.06 });
    }
  },

  // Dogal 1: hüzünlü trombon "wah wah wah waaaah"
  fumble(ctx) {
    const out = master(ctx, 0.6);
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1100;
    lp.connect(out);
    const notes = [[392, 0.45], [370, 0.45], [349.2, 0.45], [329.6, 1.6]];
    let at = t;
    notes.forEach(([f, d], i) => {
      const o = tone(ctx, lp, { type: "sawtooth", freq: f, start: at, dur: d, vol: 0.35, attack: 0.05 });
      if (i === notes.length - 1) {
        // Son notada titreme
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = 6;
        lg.gain.value = 9;
        lfo.connect(lg); lg.connect(o.frequency);
        lfo.start(at + 0.25); lfo.stop(at + d);
        o.frequency.setValueAtTime(f, at + 0.25);
        o.frequency.exponentialRampToValueAtTime(f * 0.92, at + d);
      }
      at += d;
    });
  },

};

export function playSound(name) { play(name); }

function play(name) {
  if (!soundSettings.level("fx")) return;
  const ctx = ac();
  if (!ctx) return;
  try { SOUNDS[name](ctx); } catch { /* ses calinamazsa sessiz devam */ }
}

/* ================================================================ */
/* Gorsel efektler                                                   */
/* ================================================================ */

let layer = null;
let current = null;

export function fxLayer() { return getLayer(); }

function getLayer() {
  if (!layer) {
    layer = h("div.fx-layer");
    document.body.append(layer);
  }
  return layer;
}

/** Atisin dogal d20 sonucunu bulur (tek d20 bolumu ve tek tutulan zar varsa). */
export function naturalD20(roll) {
  const d20 = roll.parts.filter((p) => p.type === "dice" && p.sides === 20);
  if (d20.length !== 1) return null;
  const kept = d20[0].rolls.filter((r) => !r.dropped);
  if (kept.length !== 1) return null;
  return kept[0].v;
}


function d20Svg() {
  return `<svg viewBox="0 0 100 100" class="fx-die-svg"><polygon points="50,3 93,27 93,73 50,97 7,73 7,27" class="fx-face"/><polygon points="50,3 27,40 73,40" class="fx-edge"/><polygon points="27,40 73,40 50,82" class="fx-front"/><polyline points="7,27 27,40 7,73 50,82 93,73 73,40 93,27" class="fx-line"/><polyline points="27,40 50,82 73,40 50,3 27,40" class="fx-line"/><line x1="50" y1="82" x2="50" y2="97" class="fx-line"/></svg>`;
}

/**
 * Bir zar atisini oynatir.
 * msg: sohbetteki zar mesaji
 */
export function playRoll(msg) {
  const roll = msg.roll;
  const nat = naturalD20(roll);
  const kind = nat === 20 ? "crit" : nat === 1 ? "fumble" : "normal";
  show(kind, roll, msg);
}

/** /deneme komutu icin: sadece bu ekranda efekt gosterir */
export function preview(value) {
  const v = Number(value);
  const roll = { expr: "1d20", total: v, parts: [{ type: "dice", sign: 1, count: 1, sides: 20, keep: null, rolls: [{ v, dropped: false }] }] };
  playRoll({ name: "Deneme", color: "#d0a752", label: "", roll });
}

function show(kind, roll, msg) {
  const root = getLayer();
  if (current) current.remove();

  const nat = naturalD20(roll);
  const shownValue = nat !== null ? nat : roll.total;
  const box = h("div.fx-roll", { class: "fx-" + kind });
  box.innerHTML = `<div class="fx-die">${d20Svg()}<span class="fx-num">?</span></div>`;
  const who = h("div.fx-who", { style: { color: msg.color } }, msg.name + (msg.label ? " · " + msg.label : ""));
  const total = h("div.fx-total", nat !== null && roll.total !== nat ? `Toplam ${roll.total}` : "");
  box.append(who, total);
  root.append(box);
  current = box;

  const num = box.querySelector(".fx-num");
  const max = nat !== null ? 20 : Math.max(6, roll.total);
  play("roll");

  // Donerken rastgele sayilar
  let ticks = 0;
  const spin = setInterval(() => {
    num.textContent = String(1 + Math.floor(Math.random() * max));
    if (++ticks > 10) clearInterval(spin);
  }, 65);

  setTimeout(() => {
    clearInterval(spin);
    num.textContent = String(shownValue);
    box.classList.add("landed");
    if (kind === "crit") celebrate(box);
    else if (kind === "fumble") disaster(box);
    else play("land");
  }, 780);

  const life = kind === "crit" ? 4200 : kind === "fumble" ? 3800 : 1900;
  setTimeout(() => {
    if (current !== box) return;
    box.classList.add("out");
    setTimeout(() => { box.remove(); if (current === box) current = null; }, 400);
  }, life);
}

/* ---------------- Dogal 20 ---------------- */

function celebrate(box) {
  play("crit");
  const root = getLayer();
  const banner = h("div.fx-banner.fx-banner-crit",
    h("div.fx-big", "DOĞAL 20!"),
    h("div.fx-small", pick(["EFSANEVİ!", "TANRILAR SENİNLE!", "KRİTİK VURUŞ!", "WAAAOOOW!"])));
  root.append(banner, h("div.fx-flash.gold"));
  box.append(h("div.fx-rays"));
  confetti();
  shake("fx-shake");
  setTimeout(() => banner.remove(), 3800);
  setTimeout(() => root.querySelector(".fx-flash")?.remove(), 900);
}

function confetti() {
  const c = h("canvas.fx-confetti");
  getLayer().append(c);
  const ctx = c.getContext("2d");
  const W = (c.width = innerWidth), H = (c.height = innerHeight);
  const colors = ["#f6d27a", "#d0a752", "#fff3c4", "#e05d5d", "#5aa0e6", "#5cbf75", "#a46be0"];
  const parts = [];
  for (let i = 0; i < 180; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 6 + Math.random() * 14;
    parts.push({
      x: W / 2, y: H / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 6,
      w: 6 + Math.random() * 8, h: 4 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      c: colors[i % colors.length],
    });
  }
  const t0 = performance.now();
  (function frame(now) {
    const age = now - t0;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.35; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, 1 - age / 3200);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (age < 3300) requestAnimationFrame(frame); else c.remove();
  })(t0);
}

/* ---------------- Dogal 1 ---------------- */

function disaster(box) {
  play("fumble");
  const root = getLayer();
  box.querySelector(".fx-die").insertAdjacentHTML("beforeend",
    `<svg viewBox="0 0 100 100" class="fx-crack"><polyline points="48,2 44,22 55,34 41,52 52,63 46,80 50,98"/><polyline points="55,34 70,42 82,38"/><polyline points="41,52 26,57 14,70"/></svg>`);
  const banner = h("div.fx-banner.fx-banner-fumble",
    h("div.fx-big", "KRİTİK BAŞARISIZLIK"),
    h("div.fx-small", pick(["Eyvah eyvah…", "Zarlar seni sevmiyor.", "Bunu hiç görmedik, tamam mı?", "Hmm… olmadı."])));
  root.append(banner, h("div.fx-gloom"));
  shake("fx-wobble");
  setTimeout(() => banner.remove(), 3600);
  setTimeout(() => root.querySelector(".fx-gloom")?.remove(), 3600);
}


/* ---------------- Yardimcilar ---------------- */

function shake(cls) {
  const app = document.getElementById("app");
  if (!app) return;
  app.classList.remove("fx-shake", "fx-wobble", "fx-shake-hard");
  void app.offsetWidth;
  app.classList.add(cls);
  setTimeout(() => app.classList.remove(cls), 1600);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}
