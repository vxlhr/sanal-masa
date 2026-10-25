// Ortam sesi ve muzik: DM baslatir, herkeste calar. Hazir ortam sesleri Web Audio ile uretilir,
// DM kendi MP3/OGG dosyasini da yukleyip calabilir. Ses duzeyi herkesin kendi ayaridir.
import { toast } from "./util.js";
import { soundSettings } from "./sound.js";

export const AMBIENT = [
  { key: "rain", name: "Yağmur", emoji: "🌧️" },
  { key: "storm", name: "Fırtına", emoji: "⛈️" },
  { key: "wind", name: "Rüzgâr", emoji: "🌬️" },
  { key: "fire", name: "Kamp ateşi", emoji: "🔥" },
  { key: "cave", name: "Mağara", emoji: "🕳️" },
  { key: "tavern", name: "Taverna", emoji: "🍺" },
  { key: "forest", name: "Orman", emoji: "🌲" },
];


export function createMusic(app) {
  let ctx = null;
  let master = null;
  let current = null; // { key, stop() }
  let fileAudio = null;
  let volume = soundSettings.level("music");
  let currentMusic = null;
  soundSettings.onChange(() => setVolume(soundSettings.level("music")));

  function audio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // Tarayici sesi ancak bir tiklamadan sonra acar
  document.addEventListener("pointerdown", () => {
    if (ctx && ctx.state === "suspended") ctx.resume();
    if (fileAudio && fileAudio.paused && current) fileAudio.play().catch(() => {});
  });

  /* ---------------- Ses uretimi ---------------- */

  function noiseBuffer(c, seconds, type) {
    const len = c.sampleRate * seconds;
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        if (type === "brown") { last = (last + 0.02 * white) / 1.02; d[i] = last * 3.5; }
        else d[i] = white;
      }
    }
    return buf;
  }

  function loopNoise(c, out, { type = "white", filter = "lowpass", freq = 1000, q = 0.7, gain = 0.3 }) {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 4, type);
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = filter; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(out);
    src.start();
    return { src, f, g };
  }

  function lfo(c, target, rate, depth, base) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = rate;
    g.gain.value = depth;
    o.connect(g); g.connect(target);
    if (base !== undefined) target.value = base;
    o.start();
    return o;
  }

  function blip(c, out, { freq, to, dur, vol, type = "sine", at = c.currentTime }) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(out);
    o.start(at); o.stop(at + dur + 0.05);
  }

  function burst(c, out, { dur, vol, freq, filter = "lowpass", at = c.currentTime }) {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, Math.max(0.05, dur), "white");
    const f = c.createBiquadFilter();
    f.type = filter; f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(at);
  }

  /** Rastgele aralikla tekrarlayan olay */
  function every(minMs, maxMs, fn) {
    let alive = true;
    let timer = null;
    const tick = () => {
      if (!alive) return;
      fn();
      timer = setTimeout(tick, minMs + Math.random() * (maxMs - minMs));
    };
    timer = setTimeout(tick, minMs * Math.random());
    return () => { alive = false; clearTimeout(timer); };
  }

  const GENERATORS = {
    rain(c, out) {
      const a = loopNoise(c, out, { type: "white", filter: "lowpass", freq: 2600, gain: 0.18 });
      const b = loopNoise(c, out, { type: "brown", filter: "lowpass", freq: 600, gain: 0.35 });
      const drops = every(30, 140, () => burst(c, out, { dur: 0.04, vol: 0.05 + Math.random() * 0.05, freq: 3000 + Math.random() * 3000, filter: "bandpass" }));
      return [a.src, b.src, drops];
    },
    storm(c, out) {
      const parts = GENERATORS.rain(c, out);
      const w = loopNoise(c, out, { type: "brown", filter: "bandpass", freq: 400, q: 0.8, gain: 0.25 });
      const l = lfo(c, w.f.frequency, 0.08, 250, 400);
      const thunder = every(9000, 22000, () => {
        const t = c.currentTime;
        burst(c, out, { dur: 3.5, vol: 0.9, freq: 140, at: t });
        burst(c, out, { dur: 1.2, vol: 0.5, freq: 900, at: t });
      });
      return [...parts, w.src, l, thunder];
    },
    wind(c, out) {
      const w = loopNoise(c, out, { type: "white", filter: "bandpass", freq: 500, q: 1.2, gain: 0.25 });
      const l1 = lfo(c, w.f.frequency, 0.07, 350, 550);
      const l2 = lfo(c, w.g.gain, 0.11, 0.12, 0.22);
      const low = loopNoise(c, out, { type: "brown", filter: "lowpass", freq: 300, gain: 0.3 });
      return [w.src, l1, l2, low.src];
    },
    fire(c, out) {
      const base = loopNoise(c, out, { type: "brown", filter: "lowpass", freq: 450, gain: 0.5 });
      const hiss = loopNoise(c, out, { type: "white", filter: "highpass", freq: 4000, gain: 0.015 });
      const crackle = every(40, 350, () => {
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) burst(c, out, { dur: 0.02 + Math.random() * 0.03, vol: 0.1 + Math.random() * 0.25, freq: 2000 + Math.random() * 4000, filter: "bandpass", at: c.currentTime + i * 0.03 });
      });
      return [base.src, hiss.src, crackle];
    },
    cave(c, out) {
      const drone = c.createOscillator();
      const dg = c.createGain();
      drone.type = "sine"; drone.frequency.value = 55; dg.gain.value = 0.12;
      drone.connect(dg); dg.connect(out); drone.start();
      const air = loopNoise(c, out, { type: "brown", filter: "lowpass", freq: 250, gain: 0.25 });
      const verb = c.createDelay(1); verb.delayTime.value = 0.32;
      const fb = c.createGain(); fb.gain.value = 0.45;
      verb.connect(fb); fb.connect(verb); verb.connect(out);
      const drips = every(900, 3500, () => {
        const f = 900 + Math.random() * 900;
        blip(c, verb, { freq: f, to: f * 1.9, dur: 0.12, vol: 0.18 });
        blip(c, out, { freq: f, to: f * 1.9, dur: 0.12, vol: 0.1 });
      });
      return [drone, air.src, drips];
    },
    tavern(c, out) {
      // Kalabalik ugultusu + ara sira kadeh sesi + hafif lavta
      const crowd = loopNoise(c, out, { type: "white", filter: "bandpass", freq: 700, q: 0.9, gain: 0.12 });
      const l = lfo(c, crowd.g.gain, 0.6, 0.04, 0.12);
      const crowd2 = loopNoise(c, out, { type: "brown", filter: "bandpass", freq: 350, q: 1, gain: 0.3 });
      const clink = every(2500, 7000, () => {
        const f = 2400 + Math.random() * 1600;
        blip(c, out, { freq: f, dur: 0.4, vol: 0.06, type: "triangle" });
        blip(c, out, { freq: f * 1.5, dur: 0.3, vol: 0.03, type: "sine" });
      });
      const scale = [196, 220, 246.9, 293.7, 329.6, 392, 440];
      const lute = every(380, 900, () => {
        const f = scale[Math.floor(Math.random() * scale.length)];
        blip(c, out, { freq: f, dur: 1.1, vol: 0.06, type: "triangle" });
      });
      return [crowd.src, l, crowd2.src, clink, lute];
    },
    forest(c, out) {
      const leaves = loopNoise(c, out, { type: "white", filter: "bandpass", freq: 2500, q: 0.6, gain: 0.04 });
      const l = lfo(c, leaves.g.gain, 0.15, 0.025, 0.04);
      const birds = every(1200, 4500, () => {
        const f = 2200 + Math.random() * 2000;
        const n = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
          const at = c.currentTime + i * 0.13;
          blip(c, out, { freq: f, to: f * (Math.random() > 0.5 ? 1.4 : 0.75), dur: 0.09, vol: 0.05, at });
        }
      });
      return [leaves.src, l, birds];
    },
  };

  /* ---------------- Calma ---------------- */

  function stopAll() {
    if (current) {
      for (const p of current.parts) {
        if (typeof p === "function") p();
        else try { p.stop(); } catch { /* yok */ }
      }
      if (current.bus) {
        const g = current.bus;
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
        setTimeout(() => g.disconnect(), 1500);
      }
    }
    if (fileAudio) { fileAudio.pause(); fileAudio = null; }
    current = null;
  }

  function playAmbient(key) {
    const c = audio();
    const bus = c.createGain();
    bus.gain.value = 0;
    bus.connect(master);
    bus.gain.setTargetAtTime(1, c.currentTime, 0.8);
    const parts = GENERATORS[key](c, bus);
    current = { key, parts, bus };
  }

  function playFile(m) {
    const a = new Audio(m.url);
    a.loop = true;
    a.volume = volume;
    a.addEventListener("loadedmetadata", () => {
      if (a.duration && isFinite(a.duration)) a.currentTime = ((Date.now() - m.startedAt) / 1000) % a.duration;
    });
    a.play().catch(() => toast("Müziği duymak için sayfada bir yere tıkla 🎵"));
    fileAudio = a;
    current = { key: m.url, parts: [], bus: null };
  }

  function sync(m) {
    const key = m ? (m.kind === "ambient" ? m.track : m.url) + ":" + m.startedAt : null;
    if (key === (current && current.sig)) return;
    stopAll();
    if (!m) { renderPill(null); return; }
    try {
      if (m.kind === "ambient" && GENERATORS[m.track]) playAmbient(m.track);
      else if (m.kind === "file") playFile(m);
    } catch {
      toast("Ses çalınamadı.", "error");
    }
    if (current) current.sig = key;
    renderPill(m);
  }

  function setVolume(v) {
    volume = v;
    if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    if (fileAudio) fileAudio.volume = v;
  }

  function renderPill(m) {
    currentMusic = m;
    if (app.onMusicChange) app.onMusicChange(m);
  }

  return {
    onState(st) { sync(st.music); },
    get current() { return currentMusic; },
  };
}
