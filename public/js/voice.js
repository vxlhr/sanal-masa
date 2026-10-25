// Sesli sohbet: WebRTC ile herkes herkese dogrudan baglanir (en fazla 10 kisi).
// Sunucu sadece baglanti bilgisini iletir; ses sunucudan gecmez.
import { h, $, toast, icon, fill } from "./util.js";
import { soundSettings } from "./sound.js";

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
  let localAnalyser = null;

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
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      joining = false;
      toast("Mikrofon izni verilmedi. Tarayıcının adres çubuğundaki kilit simgesinden izin verebilirsin.", "error");
      return;
    }
    joining = false;
    joined = true;
    muted = false;
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    localAnalyser = analyser(stream);
    meterTimer = setInterval(meter, 150);
    app.send({ t: "voice.join" });
    toast("Sesli sohbete katıldın 🎙", "ok");
    render();
  }

  function leave() {
    if (!joined) return;
    joined = false;
    for (const cid of [...peers.keys()]) closePeer(cid);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    localAnalyser = null;
    clearInterval(meterTimer);
    speaking.clear();
    app.send({ t: "voice.leave" });
    pop.hidden = true;
    render();
  }

  function toggleMute() {
    if (!stream) return;
    muted = !muted;
    stream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
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
    if (!muted && level(localAnalyser) > 0.04 && app.state) now.add(app.state.you.id);
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
    muteBtn.replaceChildren(icon(muted ? "mic-off" : "mic"));
    muteBtn.title = muted ? "Mikrofonu aç" : "Mikrofonu kapat";
    paintDots();
    if (!pop.hidden) renderPop();
  }

  function renderPop() {
    const players = (app.state && app.state.players) || [];
    const name = (pid) => (players.find((p) => p.id === pid) || {}).name || "?";
    const rows = [...peers.values()].map((p) => {
      const state = p.pc.connectionState;
      return h("div.voice-row",
        h("span.voice-name", name(p.playerId)),
        h("span.voice-state", { class: state }, state === "connected" ? "bağlı" : state === "failed" ? "bağlanamadı" : "bağlanıyor…"),
        h("input", {
          type: "range", min: 0, max: 1, step: 0.05, title: "Bu kişinin ses düzeyi",
          value: volumes[p.playerId] ?? 1,
          onInput: (e) => {
            volumes[p.playerId] = Number(e.target.value);
            p.audio.volume = volumes[p.playerId] * soundSettings.level("voice");
            try { localStorage.setItem(VOL_KEY, JSON.stringify(volumes)); } catch { /* yok */ }
          },
        }));
    });
    fill(pop,
      h("div.voice-title", "Sesli sohbet"),
      rows.length ? h("div", rows) : h("p.muted.small-text", "Henüz kimse yok. Arkadaşların da 'Sesli sohbet'e bassın."),
      h("p.muted.small-text", "Ses doğrudan tarayıcılar arasında akar. Bazı okul/iş ağlarında çalışmayabilir."),
      h("button.btn.small.danger.block", { type: "button", onClick: leave }, "Sesli sohbetten ayrıl"));
  }

  btn.addEventListener("click", () => {
    if (!joined) { join(); return; }
    pop.hidden = !pop.hidden;
    if (!pop.hidden) renderPop();
  });
  muteBtn.addEventListener("click", toggleMute);
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
  };
}
