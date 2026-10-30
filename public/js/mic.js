// Mikrofon isleme hatti: yapay zeka gurultu engelleme (RNNoise / GTCRN), ses kapisi ve bas-konus.
//
//   mikrofon -> [gurultu suzgeci] -> ses kapisi -> bas-konus -> karsi tarafa giden ses
//
// Gurultu suzgecleri @sapphi-red/web-noise-suppressor paketinden (public/vendor/gurultu, lisanslar orada).
// Tarayici desteklemezse (AudioWorklet yok, ornek hizi uyusmazligi...) ham mikrofon sesiyle devam eder.

const KEY = "sanalmasa.mikrofon";
const VENDOR = "/vendor/gurultu/";

export const NS_MODES = [
  { key: "off", label: "Kapalı", hint: "Hiç süzgeç yok. Stüdyo mikrofonu ve sessiz oda için." },
  { key: "browser", label: "Standart", hint: "Tarayıcının kendi süzgeci. Hafif uğultuyu biraz azaltır." },
  { key: "rnnoise", label: "Hafif", hint: "Hafif yapay zeka (RNNoise): gürültüyü biraz azaltır, işlemciyi çok az yorar. Eski bilgisayar ve telefonlar için." },
  { key: "gtcrn", label: "Güçlü", hint: "Yapay zeka (GTCRN): fan, klima, klavye ve hışırtıyı neredeyse tamamen siler, sesine dokunmaz. Önerilen." },
];

export const micSettings = { ns: "gtcrn", gate: true, gateDb: -50, ptt: false, deviceId: "" };
try { Object.assign(micSettings, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { /* yok */ }

export function saveMicSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(micSettings)); } catch { /* yok */ }
}

function constraints(useBrowserNs, deviceId) {
  return {
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: 1,
      echoCancellation: true, // hoparlorden gelen sesi geri gondermemek icin her zaman acik
      noiseSuppression: useBrowserNs,
      autoGainControl: true,
    },
  };
}

async function getRaw(useBrowserNs, deviceId) {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints(useBrowserNs, deviceId));
  } catch (err) {
    // Secili mikrofon artik yoksa varsayilana don
    if (deviceId && (err.name === "OverconstrainedError" || err.name === "NotFoundError")) {
      micSettings.deviceId = "";
      saveMicSettings();
      return navigator.mediaDevices.getUserMedia(constraints(useBrowserNs, ""));
    }
    throw err;
  }
}

export async function listMics() {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  } catch {
    return [];
  }
}

/* ---------------- Gurultu suzgeci yukleme (bir kez) ---------------- */

let libPromise = null;
const wasmCache = {};
const loadedWorklets = new WeakMap(); // AudioContext -> Set(tur)

async function createSuppressor(ctx, kind) {
  if (!ctx.audioWorklet) throw new Error("AudioWorklet yok");
  libPromise = libPromise || import(VENDOR + "index.js");
  const lib = await libPromise;
  const done = loadedWorklets.get(ctx) || new Set();
  loadedWorklets.set(ctx, done);
  if (kind === "rnnoise") {
    wasmCache.rnnoise = wasmCache.rnnoise || await lib.loadRnnoise({ url: VENDOR + "rnnoise.wasm", simdUrl: VENDOR + "rnnoise_simd.wasm" });
    if (!done.has(kind)) { await ctx.audioWorklet.addModule(VENDOR + "rnnoiseWorklet.js"); done.add(kind); }
    return new lib.RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: wasmCache.rnnoise });
  }
  wasmCache.gtcrn = wasmCache.gtcrn || await lib.loadGtcrn({ url: VENDOR + "gtcrn.wasm" });
  if (!done.has(kind)) { await ctx.audioWorklet.addModule(VENDOR + "gtcrnWorklet.js"); done.add(kind); }
  return new lib.GtcrnWorkletNode(ctx, { maxChannels: 1, wasmBinary: wasmCache.gtcrn });
}

/* ---------------- Hat ---------------- */

/**
 * Mikrofonu acar ve isleme hattini kurar. Mikrofon izni verilmezse hata firlatir.
 * Donen nesnenin .stream ozelligi karsi tarafa gonderilecek sestir.
 */
export async function openMic() {
  const s = micSettings;
  const aiMode = s.ns === "rnnoise" || s.ns === "gtcrn";
  let raw = await getRaw(s.ns === "browser", s.deviceId);

  let ctx = null;
  let src = null;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctx({ sampleRate: 48000, latencyHint: "interactive" });
    src = ctx.createMediaStreamSource(raw);
  } catch {
    // Bu tarayicida ses isleme kurulamadi: ham mikrofonla devam
    if (ctx) ctx.close().catch(() => {});
    if (aiMode) {
      raw.getTracks().forEach((t) => t.stop());
      raw = await getRaw(true, s.deviceId);
    }
    return simpleMic(raw);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const gate = ctx.createGain();
  const out = ctx.createGain();
  const monitor = ctx.createGain();
  monitor.gain.value = 0;
  const dest = ctx.createMediaStreamDestination();
  gate.connect(out);
  out.connect(dest);
  out.connect(monitor);
  monitor.connect(ctx.destination);

  let suppressor = null;
  let mode = "off";
  let rawHasBrowserNs = s.ns === "browser";
  let talking = false;
  let open = true;
  let holdUntil = 0;
  let levelDb = -100;

  function wire() {
    try { src.disconnect(); } catch { /* yok */ }
    if (suppressor) { try { suppressor.disconnect(); } catch { /* yok */ } src.connect(suppressor); }
    const head = suppressor || src;
    head.connect(analyser);
    head.connect(gate);
  }

  async function replaceRaw(useBrowserNs, deviceId) {
    const next = await getRaw(useBrowserNs, deviceId);
    raw.getTracks().forEach((t) => t.stop());
    try { src.disconnect(); } catch { /* yok */ }
    raw = next;
    rawHasBrowserNs = useBrowserNs;
    src = ctx.createMediaStreamSource(raw);
    wire();
  }

  /** Gurultu engelleme modunu degistir. Yapay zeka yuklenemezse standarda doner ve hata firlatir. */
  async function setMode(next) {
    const wantBrowser = next === "browser";
    if (wantBrowser !== rawHasBrowserNs) await replaceRaw(wantBrowser, micSettings.deviceId);
    if (suppressor) {
      try { suppressor.disconnect(); suppressor.destroy && suppressor.destroy(); } catch { /* yok */ }
      suppressor = null;
    }
    if (next === "rnnoise" || next === "gtcrn") {
      try {
        suppressor = await createSuppressor(ctx, next);
      } catch (err) {
        await replaceRaw(true, micSettings.deviceId);
        mode = "browser";
        wire();
        throw new Error("Yapay zeka gürültü engelleme bu tarayıcıda çalışmadı, standart süzgece geçildi.");
      }
    }
    mode = next;
    wire();
    return mode;
  }

  // Ses kapisi: konusmadiginda mikrofonu yumusakca kapatir
  const buf = new Float32Array(analyser.fftSize);
  const gateTimer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    levelDb = 10 * Math.log10(sum / buf.length + 1e-12);
    const now = performance.now();
    if (!micSettings.gate) open = true;
    else if (levelDb > micSettings.gateDb) { open = true; holdUntil = now + 300; }
    else if (now > holdUntil) open = false;
    gate.gain.setTargetAtTime(open ? 1 : 0, ctx.currentTime, open ? 0.008 : 0.06);
  }, 20);

  function applyPtt() {
    const pass = !micSettings.ptt || talking;
    out.gain.setTargetAtTime(pass ? 1 : 0, ctx.currentTime, pass ? 0.005 : 0.03);
  }

  let warning = null;
  try {
    await setMode(s.ns);
  } catch (err) {
    warning = err.message;
    s.ns = "browser";
    saveMicSettings();
  }
  applyPtt();

  return {
    stream: dest.stream,
    advanced: true,
    warning,
    setMuted(m) { dest.stream.getAudioTracks().forEach((t) => { t.enabled = !m; }); },
    get mode() { return mode; },
    get levelDb() { return levelDb; },
    get gateOpen() { return open; },
    get transmitting() { return open && (!micSettings.ptt || talking); },
    setMode,
    async setDevice(id) {
      micSettings.deviceId = id;
      saveMicSettings();
      await replaceRaw(rawHasBrowserNs, id);
    },
    setPtt(on) { micSettings.ptt = on; saveMicSettings(); applyPtt(); },
    setTalking(on) { talking = on; applyPtt(); },
    setMonitor(on) { monitor.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.02); },
    stop() {
      clearInterval(gateTimer);
      raw.getTracks().forEach((t) => t.stop());
      dest.stream.getTracks().forEach((t) => t.stop());
      if (suppressor && suppressor.destroy) try { suppressor.destroy(); } catch { /* yok */ }
      ctx.close().catch(() => {});
    },
  };
}

/** Ses isleme desteklenmeyen tarayicilar icin: ham mikrofon, sadece seviye olcumu */
function simpleMic(raw) {
  let analyser = null;
  let ctx = null;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(raw).connect(analyser);
  } catch { analyser = null; }
  const buf = new Float32Array(1024);
  const level = () => {
    if (!analyser) return -100;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return 10 * Math.log10(sum / buf.length + 1e-12);
  };
  let talking = false;
  let muted = false;
  const applyPtt = () => raw.getAudioTracks().forEach((t) => { t.enabled = !muted && (!micSettings.ptt || talking); });
  applyPtt();
  return {
    stream: raw,
    advanced: false,
    warning: "Bu tarayıcı gelişmiş gürültü engellemeyi desteklemiyor; standart süzgeç kullanılıyor.",
    setMuted(m) { muted = m; applyPtt(); },
    get mode() { return "browser"; },
    get levelDb() { return level(); },
    get gateOpen() { return true; },
    get transmitting() { return !micSettings.ptt || talking; },
    async setMode() { throw new Error("Bu tarayıcı gelişmiş ses işlemeyi desteklemiyor."); },
    async setDevice() { throw new Error("Bu tarayıcıda mikrofon değiştirmek için sesli sohbetten çıkıp tekrar gir."); },
    setPtt(on) { micSettings.ptt = on; saveMicSettings(); applyPtt(); },
    setTalking(on) { talking = on; applyPtt(); },
    setMonitor() {},
    stop() { raw.getTracks().forEach((t) => t.stop()); if (ctx) ctx.close().catch(() => {}); },
  };
}
