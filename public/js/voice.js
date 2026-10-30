// Sesli sohbet: WebRTC ile herkes herkese dogrudan baglanir (en fazla 10 kisi).
// Sunucu sadece baglanti bilgisini iletir; ses sunucudan gecmez.
import { h, $, toast, icon, fill } from "./util.js";
import { soundSettings } from "./sound.js";
import { openMic, micSettings, saveMicSettings, NS_MODES, listMics } from "./mic.js";

const DEFAULT_ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }];
const VOL_KEY = "sanalmasa.sesler";

export function createVoice(app) {
  let joined = false;
  let joining = false;
  let stream = null;
  let muted = false;
  let iceServers = DEFAULT_ICE;
  let roster = [];
  const peers = new Map(); // cid -> { pc, audio, playerId, pending: [], level }
  const remoteMuted = new Set();
  const speaking = new Set(); // playerId
  let volumes = {};
  try { volumes = JSON.parse(localStorage.getItem(VOL_KEY) || "{}"); } catch { /* yok */ }
  let actx = null;
  let meterTimer = null;
  let mic = null;
  let monitoring = false;

  const btn = $("#voiceBtn");
  const muteBtn = $("#muteBtn");
  const pop = $("#voicePop");

  soundSettings.onChange(() => {
    for (const p of peers.values()) p.audio.volume = (volumes[p.playerId] ?? 1) * soundSettings.level("voice");
  });

  fetch("/api/info").then((r) => r.json()).then((i) => { if (i.iceServers) iceServers = i.iceServers; }).catch(() => {});

  /* ---------------- Katil / ayril ---------------- */

  async function join() {
    if (joined || joining) return;
    if (!window.isSecureContext) {
      toast("Sesli sohbet için https adresi (İnternete Aç) ya da localhost gerekir.", "error");
      return;
    }
    if (!navigator.mediaDevices || !window.RTCPeerConnection) {
      toast("Bu tarayıcı sesli sohbeti desteklemiyor.", "error");
      return;
    }
    joining = true;
    btn.querySelector("span").textContent = "Mikrofon açılıyor…";
    try {
      mic = await openMic();
    } catch (err) {
      joining = false;
      render();
      if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        toast("Mikrofon izni verilmedi. Tarayıcının adres çubuğundaki kilit simgesinden izin verebilirsin.", "error");
      } else if (err && err.name === "NotFoundError") {
        toast("Mikrofon bulunamadı. Bir mikrofon ya da kulaklık tak.", "error");
      } else {
        toast("Mikrofon açılamadı: " + (err && err.message ? err.message : "bilinmeyen hata"), "error");
      }
      return;
    }
    stream = mic.stream;
    if (mic.warning) toast(mic.warning, "error");
    joining = false;
    joined = true;
    muted = false;
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    meterTimer = setInterval(meter, 150);
    app.send({ t: "voice.join" });
    toast("Sesli sohbete katıldın 🎙", "ok");
    render();
  }

  function leave() {
    if (!joined) return;
    joined = false;
    for (const cid of [...peers.keys()]) closePeer(cid);
    if (mic) mic.stop();
    mic = null;
    stream = null;
    monitoring = false;
    clearInterval(meterTimer);
    speaking.clear();
    app.send({ t: "voice.leave" });
    pop.hidden = true;
    micBox = null;
    render();
  }

  function toggleMute() {
    if (!mic) return;
    muted = !muted;
    mic.setMuted(muted);
    app.send({ t: "voice.state", muted });
    render();
  }

  /* ---------------- WebRTC ---------------- */

  function createPeer(cid, playerId) {
    const pc = new RTCPeerConnection({ iceServers });
    const audio = new Audio();
    audio.autoplay = true;
    audio.volume = (volumes[playerId] ?? 1) * soundSettings.level("voice");
    const peer = { pc, audio, playerId, pending: [], an: null };
    peers.set(cid, peer);

    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => {
      if (e.candidate) app.send({ t: "voice.signal", to: cid, data: { candidate: e.candidate } });
    };
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0];
      audio.play().catch(() => toast("Sesi duymak için sayfada bir yere tıkla.", "error"));
      peer.an = analyser(e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        const p = app.state && app.state.players.find((x) => x.id === playerId);
        toast(`${p ? p.name : "Bir oyuncu"} ile ses bağlantısı kurulamadı (ağ engeli olabilir).`, "error");
      }
      render();
    };
    return peer;
  }

  async function offer(cid, playerId) {
    const peer = createPeer(cid, playerId);
    const desc = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(desc);
    app.send({ t: "voice.signal", to: cid, data: { sdp: peer.pc.localDescription } });
  }

  async function onSignal(from, data) {
    if (!joined) return;
    let peer = peers.get(from);
    if (data.sdp) {
      if (data.sdp.type === "offer") {
        if (!peer) {
          const m = roster.find((x) => x.cid === from);
          peer = createPeer(from, m ? m.playerId : null);
        }
        await peer.pc.setRemoteDescription(data.sdp);
        const ans = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(ans);
        app.send({ t: "voice.signal", to: from, data: { sdp: peer.pc.localDescription } });
      } else if (peer) {
        await peer.pc.setRemoteDescription(data.sdp);
      }
      if (peer) {
        for (const c of peer.pending) await peer.pc.addIceCandidate(c).catch(() => {});
        peer.pending = [];
      }
    } else if (data.candidate && peer) {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
      else peer.pending.push(data.candidate);
    }
  }

  function closePeer(cid) {
    const p = peers.get(cid);
    if (!p) return;
    try { p.pc.close(); } catch { /* yok */ }
    p.audio.srcObject = null;
    peers.delete(cid);
  }

  function onRoster(members) {
    roster = members;
    if (!joined) { render(); return; }
    const me = app.cid;
    const ids = new Set(members.map((m) => m.cid));
    for (const cid of [...peers.keys()]) if (!ids.has(cid)) closePeer(cid);
    for (const m of members) {
      if (m.cid === me || peers.has(m.cid)) continue;
      // Ayni anda iki taraf teklif yapmasin: kucuk kimlikli olan baslatir
      if (me < m.cid) offer(m.cid, m.playerId).catch(() => {});
    }
    render();
  }

  /* ---------------- Konusma gostergesi ---------------- */

  function analyser(ms) {
    try {
      const src = actx.createMediaStreamSource(ms);
      const an = actx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      return an;
    } catch {
      return null;
    }
  }

  const buf = new Uint8Array(512);
  function level(an) {
    if (!an) return 0;
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    return Math.sqrt(sum / buf.length);
  }

  function meter() {
    const now = new Set();
    if (mic && !muted && mic.transmitting && mic.levelDb > (micSettings.gate ? micSettings.gateDb : -45) && app.state) now.add(app.state.you.id);
    for (const p of peers.values()) if (p.playerId && level(p.an) > 0.04) now.add(p.playerId);
    const changed = now.size !== speaking.size || [...now].some((x) => !speaking.has(x));
    if (!changed) return;
    speaking.clear();
    now.forEach((x) => speaking.add(x));
    paintDots();
  }

  /* ---------------- Arayuz ---------------- */

  function paintDots() {
    const inVoice = new Set(roster.map((m) => m.playerId));
    document.querySelectorAll(".pdot[data-pid]").forEach((d) => {
      const pid = d.dataset.pid;
      d.classList.toggle("in-voice", inVoice.has(pid));
      d.classList.toggle("speaking", speaking.has(pid));
      d.classList.toggle("voice-muted", remoteMuted.has(pid));
    });
  }

  function render() {
    btn.classList.toggle("on", joined);
    btn.title = joined ? "Sesli sohbet: kişiler ve ses ayarı" : "Sesli sohbete katıl";
    btn.querySelector("span").textContent = joined ? `Sesli (${roster.length})` : roster.length ? `Sesli sohbet (${roster.length})` : "Sesli sohbet";
    muteBtn.hidden = !joined;
    muteBtn.classList.toggle("muted", muted);
    muteBtn.classList.toggle("ptt", micSettings.ptt && !muted);
    muteBtn.replaceChildren(icon(muted ? "mic-off" : "mic"));
    muteBtn.title = muted ? "Mikrofonu aç" : micSettings.ptt ? "Bas-konuş: basılı tut (ya da 1'in solundaki tuş)" : "Mikrofonu kapat";
    paintDots();
    if (!pop.hidden) renderPop();
  }

  /* ---------------- Ayar penceresi ---------------- */

  const peersBox = h("div.voice-peers");
  let micBox = null;
  let popTimer = null;

  function renderPeers() {
    const players = (app.state && app.state.players) || [];
    const name = (pid) => (players.find((p) => p.id === pid) || {}).name || "?";
    const rows = [...peers.values()].map((p) => {
      const state = p.pc.connectionState;
      return h("div.voice-row",
        h("span.voice-name", name(p.playerId)),
        h("span.voice-state", { class: state }, state === "connected" ? "bağlı" : state === "failed" ? "bağlanamadı" : "bağlanıyor…"),
        h("input.snd-range", {
          type: "range", min: 0, max: 1, step: 0.05, title: "Bu kişinin ses düzeyi",
          value: volumes[p.playerId] ?? 1,
          style: { "--fill": (volumes[p.playerId] ?? 1) * 100 + "%" },
          onInput: (e) => {
            volumes[p.playerId] = Number(e.target.value);
            e.target.style.setProperty("--fill", volumes[p.playerId] * 100 + "%");
            p.audio.volume = volumes[p.playerId] * soundSettings.level("voice");
            try { localStorage.setItem(VOL_KEY, JSON.stringify(volumes)); } catch { /* yok */ }
          },
        }));
    });
    fill(peersBox,
      h("div.voice-sub", "Kişiler"),
      rows.length ? rows : h("p.muted.small-text", { style: { margin: 0 } }, "Henüz kimse yok. Arkadaşların da 'Sesli sohbet'e bassın."));
  }

  /** Ses kapisi esigi ve canli seviye: -80 dB .. -10 dB araligi */
  const dbToPct = (db) => Math.max(0, Math.min(100, ((db + 80) / 70) * 100));

  function buildMicBox() {
    const modeHint = h("p.mic-hint");
    const modeSeg = h("div.seg.mic-modes");
    const setModeUi = () => {
      const m = mic ? mic.mode : micSettings.ns;
      modeSeg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
      modeHint.textContent = (NS_MODES.find((x) => x.key === m) || {}).hint || "";
    };
    NS_MODES.forEach((m) => modeSeg.append(h("button", {
      type: "button", "data-mode": m.key, title: m.hint,
      onClick: async () => {
        if (!mic) return;
        modeSeg.classList.add("busy");
        try {
          micSettings.ns = await mic.setMode(m.key);
        } catch (err) {
          micSettings.ns = mic.mode;
          toast(err.message, "error");
        }
        saveMicSettings();
        modeSeg.classList.remove("busy");
        setModeUi();
      },
    }, m.label)));

    const deviceSel = h("select.input.mic-device", {
      onChange: async (e) => {
        try { await mic.setDevice(e.target.value); toast("Mikrofon değişti", "ok"); }
        catch (err) { toast(err.message, "error"); }
      },
    });
    listMics().then((list) => {
      fill(deviceSel, list.length ? list.map((d, i) => h("option", { value: d.deviceId, selected: d.deviceId === micSettings.deviceId }, d.label || `Mikrofon ${i + 1}`))
        : h("option", { value: "" }, "Varsayılan mikrofon"));
      if (!micSettings.deviceId) deviceSel.value = list[0] ? list[0].deviceId : "";
    });

    // Canli seviye cubugu ve esik isareti
    const levelFill = h("div.mic-level-fill");
    const marker = h("div.mic-level-marker");
    const levelBar = h("div.mic-level", levelFill, marker);
    const gateRange = h("input.snd-range", {
      type: "range", min: -80, max: -10, step: 1, value: micSettings.gateDb,
      onInput: (e) => {
        micSettings.gateDb = Number(e.target.value);
        saveMicSettings();
        paintGate();
      },
    });
    const gateRow = h("div.mic-gate", levelBar, gateRange,
      h("p.mic-hint", "Konuşurken çubuk işaretin sağına geçmeli, sessizken solunda kalmalı. Klavye ve nefes sesi işaretin solunda kalırsa karşıya gitmez."));
    const paintGate = () => {
      const pct = dbToPct(micSettings.gateDb);
      marker.style.left = pct + "%";
      gateRange.style.setProperty("--fill", ((micSettings.gateDb + 80) / 70) * 100 + "%");
      gateRow.classList.toggle("disabled", !micSettings.gate);
    };

    const sw = (label, checked, onChange, hint) => h("label.switch.mic-switch", { title: hint || "" },
      h("input", { type: "checkbox", checked, onChange: (e) => onChange(e.target.checked) }), h("span"), label);

    micBox = h("div.mic-box",
      h("div.voice-sub", "Mikrofon"),
      deviceSel,
      h("div.voice-sub", "Gürültü engelleme"),
      modeSeg,
      modeHint,
      sw("Ses kapısı (konuşmadığında sustur)", micSettings.gate, (on) => { micSettings.gate = on; saveMicSettings(); paintGate(); }),
      gateRow,
      sw("Bas-konuş", micSettings.ptt, (on) => { mic.setPtt(on); render(); },
        "Sadece tuşa basılı tutarken konuşursun"),
      h("p.mic-hint", "Bas-konuş açıkken 1'in solundaki tuşu (\" ya da `) ya da üstteki mikrofon düğmesini basılı tut."),
      sw("Kendi sesimi dinle (kulaklıkla)", monitoring, (on) => { monitoring = on; mic.setMonitor(on); },
        "Süzgeçten geçen sesini duyarsın. Hoparlörle açarsan yankı olur."),
      mic && !mic.advanced ? h("p.mic-hint.warn", "Bu tarayıcı yapay zeka süzgecini desteklemiyor. Chrome, Edge ya da Opera önerilir.") : null);

    setModeUi();
    paintGate();
    micBox.updateLevel = () => {
      if (!mic) return;
      const db = mic.levelDb;
      levelFill.style.width = dbToPct(db) + "%";
      levelBar.classList.toggle("open", mic.gateOpen && mic.transmitting && !muted);
    };
  }

  function renderPop() {
    if (!micBox) buildMicBox();
    renderPeers();
    if (!pop.contains(micBox)) {
      fill(pop,
        h("div.voice-title", "Sesli sohbet"),
        micBox,
        peersBox,
        h("p.muted.small-text", { style: { margin: 0 } }, "Ses doğrudan tarayıcılar arasında akar. Bazı okul/iş ağlarında çalışmayabilir."),
        h("button.btn.small.danger.block", { type: "button", onClick: leave }, "Sesli sohbetten ayrıl"));
    }
    clearInterval(popTimer);
    popTimer = setInterval(() => {
      if (pop.hidden || !micBox) { clearInterval(popTimer); return; }
      micBox.updateLevel();
    }, 60);
  }

  btn.addEventListener("click", () => {
    if (!joined) { join(); return; }
    pop.hidden = !pop.hidden;
    if (!pop.hidden) renderPop();
  });
  muteBtn.addEventListener("click", () => { if (!micSettings.ptt) toggleMute(); });
  // Bas-konus: mikrofon dugmesini basili tut
  const talk = (on) => {
    if (!mic || !micSettings.ptt || muted) return;
    mic.setTalking(on);
    muteBtn.classList.toggle("talking", on);
  };
  muteBtn.addEventListener("pointerdown", () => talk(true));
  muteBtn.addEventListener("pointerup", () => talk(false));
  muteBtn.addEventListener("pointerleave", () => talk(false));
  // Bas-konus: 1'in solundaki tus (klavye dilinden bagimsiz fiziksel tus)
  const typingIn = (e) => e.target && (e.target.matches("input, textarea, select") || e.target.isContentEditable);
  document.addEventListener("keydown", (e) => {
    if (e.code === "Backquote" && !e.repeat && micSettings.ptt && joined && !typingIn(e)) { e.preventDefault(); talk(true); }
  });
  document.addEventListener("keyup", (e) => { if (e.code === "Backquote") talk(false); });
  window.addEventListener("blur", () => talk(false));
  document.addEventListener("pointerdown", (e) => {
    if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) pop.hidden = true;
  });
  window.addEventListener("beforeunload", () => { if (joined) app.send({ t: "voice.leave" }); });

  return {
    onMessage(msg) {
      if (msg.t === "voice.roster") onRoster(msg.members);
      else if (msg.t === "voice.signal") onSignal(msg.from, msg.data).catch(() => {});
      else if (msg.t === "voice.state") {
        if (msg.muted) remoteMuted.add(msg.playerId); else remoteMuted.delete(msg.playerId);
        paintDots();
      }
    },
    onState() { paintDots(); },
    // Baglanti koparsa sunucu bizi listeden cikarir; geri gelince yeniden katil
    onReconnect() { if (joined) app.send({ t: "voice.join" }); },
    get joined() { return joined; },
    get peerStates() { return [...peers.values()].map((p) => p.pc.connectionState); },
    get mic() { return mic; },
  };
}
