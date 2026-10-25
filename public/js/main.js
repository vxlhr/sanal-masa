// Uygulama girisi: giris ekrani, baglanti, durum dagitimi, araclar ve kisayollar
import { h, $, $$, toast, PALETTE, initials, fill } from "./util.js";
import { Net } from "./net.js";
import { createBoard } from "./board.js";
import { createChat } from "./chat.js";
import { createPanels } from "./panels.js";
import { createTokenCard } from "./tokencard.js";
import { initModal, isModalOpen } from "./picker.js";
import { createExtras } from "./extras.js";
import { createVoice } from "./voice.js";
import { createMusic } from "./music.js";
import { createDmPanel } from "./dmpanel.js";
import { createSoundMenu } from "./soundmenu.js";
import { SHAPE_LABEL } from "./geometry.js";

const SESSION_KEY = "sanalmasa.oturum";
const NAME_KEY = "sanalmasa.isim";
const COLOR_KEY = "sanalmasa.renk";

const app = {
  state: null,
  secret: null,
  send: (msg) => net.send(msg),
  isTabOpen: (name) => $(".tab.active")?.dataset.tab === name && !$("#app").classList.contains("side-closed"),
  onZoom: (s) => { $("#zoomLabel").textContent = Math.round(s * 100) + "%"; },
  cardId: null,
  onSelect: (id) => {
    // Baska bir token secilince acik kart kapanir; kart sadece cift tikla acilir
    if (app.cardId && app.cardId !== id) app.cardId = null;
    if (id && !app.cardId) showCardHint();
    if (app.state) renderUi();
  },
  openCard: (id) => {
    board.select(id);
    app.cardId = id;
    if (app.state) renderUi();
  },
  closeCard: () => {
    app.cardId = null;
    if (app.state) renderUi();
  },
  onTemplateSelect: () => { if (app.state) renderTemplateBar(app.state); },
  newRef: () => "r" + Math.random().toString(36).slice(2, 10),
  recordUndo: (entry) => {
    undoStack.push(entry);
    if (undoStack.length > 50) undoStack.shift();
  },
  /** Sunucuda olusacak bir sey icin geri alma kaydi; kimligi "created" yanitiyla gelir */
  recordCreate: (kind, ref, label) => {
    app.recordUndo({
      label, ref, kind, ids: null,
      undo() {
        if (!this.ids) return false;
        const del = { draw: "draw.delete", template: "template.delete", token: "token.delete" }[kind];
        if (kind === "walls") app.send({ t: "wall.delete", ids: this.ids });
        else this.ids.forEach((id) => app.send({ t: del, id }));
        return true;
      },
    });
  },
  /** Tokenlari siler; geri alinca ayni haliyle geri gelirler */
  deleteTokens: (ids) => {
    const s = app.state && app.state.scene;
    if (!s) return;
    const tokens = ids.map((id) => s.tokens.find((t) => t.id === id)).filter(Boolean)
      .filter((t) => app.state.you.isDm || t.ownerId === app.state.you.id);
    if (!tokens.length) return;
    const copies = tokens.map((t) => JSON.parse(JSON.stringify(t)));
    tokens.forEach((t) => app.send({ t: "token.delete", id: t.id }));
    app.recordUndo({
      label: tokens.length > 1 ? `${tokens.length} token silme` : `"${tokens[0].name}" silme`,
      undo: () => copies.forEach((token) => app.send({ t: "token.restore", token })),
    });
  },
  undo: () => {
    const e = undoStack.pop();
    if (!e) { toast("Geri alınacak bir şey yok."); return; }
    if (e.undo() === false) { toast("Biraz bekle, sunucu henüz onaylamadı.", "error"); undoStack.push(e); return; }
    toast(`Geri alındı: ${e.label}`, "ok");
  },
};

const undoStack = [];
let pendingSelect = null;

/* ================================================================ */
/* Baglanti                                                          */
/* ================================================================ */

const net = new Net({
  onMessage: handleMessage,
  onStatus: (ok) => {
    $("#connDot").classList.toggle("bad", !ok);
    $("#connDot").title = ok ? "Bağlı" : "Bağlantı koptu, yeniden bağlanılıyor…";
  },
  onFatal: (reason, wasJoin) => {
    if (wasJoin) clearSession();
    if (reason && reason.includes("çıkardı")) clearSession();
    showLogin(reason);
  },
});

function loadSession() {
  if (new URLSearchParams(location.search).has("yeni")) return null;
  try { return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY); } catch { return null; }
}

function saveSession(secret) {
  try { sessionStorage.setItem(SESSION_KEY, secret); localStorage.setItem(SESSION_KEY, secret); } catch { /* gizli pencere */ }
}

function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_KEY); } catch { /* yok */ }
}

function handleMessage(msg) {
  switch (msg.t) {
    case "welcome":
      app.secret = msg.secret;
      app.cid = msg.cid;
      saveSession(msg.secret);
      net.setResume(msg.secret);
      showApp();
      voice.onReconnect();
      chat.setAll(msg.chat);
      setState(msg.state);
      break;
    case "state":
      setState(msg.state);
      break;
    case "chat":
      chat.add(msg.msg);
      break;
    case "chatAll":
      chat.setAll(msg.chat);
      break;
    case "drag":
      board.remoteDrag(msg.id, msg.x, msg.y);
      break;
    case "ping":
      board.addPing(msg);
      break;
    case "measure":
      board.remoteMeasure(msg);
      break;
    case "react":
      extras.showReaction(msg);
      break;
    case "created": {
      if (msg.kind === "token" && !msg.ref) pendingSelect = msg.id;
      const entry = msg.ref && undoStack.find((u) => u.ref === msg.ref);
      if (entry) entry.ids = msg.ids || [msg.id];
      break;
    }
    case "backups":
      if (app.onBackups) app.onBackups(msg);
      break;
    case "session":
      if (app.onSession) app.onSession(msg);
      break;
    case "voice.roster":
    case "voice.signal":
    case "voice.state":
      voice.onMessage(msg);
      break;
    case "error":
      toast(msg.message, "error");
      break;
  }
}

function setState(st) {
  app.state = st;
  document.body.classList.toggle("is-dm", st.you.isDm);
  board.onState();
  if (pendingSelect && st.scene && st.scene.tokens.some((t) => t.id === pendingSelect)) {
    app.openCard(pendingSelect);
    pendingSelect = null;
  }
  renderUi();
}

/* ================================================================ */
/* Arayuz                                                            */
/* ================================================================ */

const board = createBoard({ canvas: $("#board"), stage: $("#stage"), app });
app.board = board;
window.sanalMasa = app; // hata ayiklama icin konsoldan erisim
const chat = createChat(app);
const panels = createPanels(app);
const tokenCard = createTokenCard(app);
const extras = createExtras(app);
app.extras = extras;
const voice = createVoice(app);
app.voice = voice;
const music = createMusic(app);
app.music = music;
const dmPanel = createDmPanel(app);
createSoundMenu(app);
initModal();

function renderUi() {
  const st = app.state;
  if (!st) return;
  const s = st.scene;
  const me = st.you;

  $("#sceneTitle").textContent = s ? s.name : "Sahne yok";

  // Ust bardaki oyuncular
  $("#playerDots").replaceChildren(...st.players
    .slice().sort((a, b) => (b.isDm - a.isDm) || (b.online - a.online))
    .map((p) => h("div.pdot", {
      "data-pid": p.id,
      class: (p.online ? "" : "off ") + (p.isDm ? "dm" : ""),
      style: { background: p.color },
      title: `${p.name}${p.isDm ? " (DM)" : ""} — ${p.online ? "çevrimiçi" : "çevrimdışı"}`,
    }, initials(p.name))));

  // Savas gostergesi
  const c = s && s.combat;
  $("#combatPill").hidden = !(c && c.active);
  if (c && c.active) {
    const cur = s.tokens.find((t) => t.id === c.currentTokenId);
    $("#combatRound").textContent = c.round;
    $("#combatTurn").textContent = cur ? cur.name : "Gizli bir yaratık";
    const mine = cur && (me.isDm || cur.ownerId === me.id);
    $("#pillNext").hidden = !mine;
    $("#pillNext").textContent = me.isDm ? "Sonraki" : "Sırayı bitir";
  }

  // Bos durum
  const empty = $("#emptyState");
  if (!s) {
    empty.hidden = false;
    fill(empty,
      h("h2", me.isDm ? "Henüz sahne yok" : "Masa hazırlanıyor"),
      h("p", me.isDm ? "İlk sahneni oluştur, oyuncular otomatik olarak görecek." : "DM bir sahne açtığında harita burada görünecek."),
      me.isDm ? h("button.btn.primary", { type: "button", onClick: () => panels.openNewScene() }, "Sahne oluştur") : null);
  } else if (!s.map && !s.tokens.length && me.isDm) {
    empty.hidden = false;
    fill(empty,
      h("h2", "Bu sahnenin haritası yok"),
      h("p", "Haritalar sekmesinden bir harita seç ya da kendi görselini yükle."),
      h("button.btn.primary", { type: "button", onClick: () => openTab("scenes") }, "Haritalar"));
  } else {
    empty.hidden = true;
  }

  $("#fogEnabled").checked = !!(s && s.fog.enabled);
  $("#visionEnabled").checked = !!(s && s.vision.enabled);
  $("#visionDark").checked = !!(s && s.vision.dark);

  panels.render(st);
  tokenCard.render(st);
  extras.onState(st);
  music.onState(st);
  dmPanel.render(st);
  voice.onState(st);
  renderSelectionBar(st);
  renderTemplateBar(st);
}

let cardHintShown = false;
function showCardHint() {
  if (cardHintShown) return;
  cardHintShown = true;
  const hint = $("#hint");
  if (!hint.hidden) return;
  hint.textContent = "Ayrıntılar için tokene çift tıkla";
  hint.hidden = false;
  setTimeout(() => { if (hint.textContent.startsWith("Ayrıntılar")) hint.hidden = true; }, 2600);
}

/* ---------------- Alan sablonu duzenleme ---------------- */

let templateClipboard = null;

function selectedTemplate() {
  const s = app.state && app.state.scene;
  return s && s.templates.find((t) => t.id === board.selectedTemplateId);
}

function copyTemplate() {
  const t = selectedTemplate();
  if (!t) return false;
  templateClipboard = { shape: t.shape, size: t.size, angle: t.angle, color: t.color, x: t.x, y: t.y };
  toast("Şablon kopyalandı · Ctrl+V ile yapıştır", "ok");
  return true;
}

function pasteTemplate() {
  if (!templateClipboard) return false;
  const p = board.pointerWorld;
  const ref = app.newRef();
  app.send({ t: "template.add", ...templateClipboard, x: p.x, y: p.y, ref });
  app.recordCreate("template", ref, "Şablon yapıştırma");
  return true;
}

function renderTemplateBar(st) {
  const bar = $("#tplBar");
  const t = selectedTemplate();
  if (!t) { bar.hidden = true; bar._key = null; return; }
  const key = JSON.stringify([t.id, t.color, t.size, t.angle]);
  bar.hidden = false;
  if (bar._key === key) return;
  bar._key = key;
  const upd = (fields) => app.send({ t: "template.update", id: t.id, ...fields });
  const rotatable = t.shape === "cone" || t.shape === "line" || t.shape === "square";
  bar.replaceChildren(...[
    h("b", `${SHAPE_LABEL[t.shape]} · ${t.size} ft`),
    h("div.swatches.small", [...PALETTE, "#ffffff", "#111111"].map((c) => h("button.swatch", {
      type: "button", class: c === t.color ? "on" : "", style: { background: c }, title: "Renk",
      onClick: () => upd({ color: c }),
    }))),
    h("div.stepper", { title: "Boyut (5 ft adımlarla)" },
      h("button", { type: "button", onClick: () => upd({ size: Math.max(5, t.size - 5) }) }, "−"),
      h("span", { style: { minWidth: "44px", fontSize: "12px" } }, `${t.size} ft`),
      h("button", { type: "button", onClick: () => upd({ size: t.size + 5 }) }, "+")),
    rotatable ? h("div.stepper", { title: "Döndür" },
      h("button", { type: "button", onClick: () => upd({ angle: t.angle - Math.PI / 12 }) }, "⟲"),
      h("button", { type: "button", onClick: () => upd({ angle: t.angle + Math.PI / 12 }) }, "⟳")) : null,
    h("button.btn.small", { type: "button", title: "Ctrl+C, sonra haritada Ctrl+V", onClick: copyTemplate }, "Kopyala"),
    h("button.btn.small.danger", { type: "button", title: "Delete", onClick: () => app.send({ t: "template.delete", id: t.id }) }, "Sil"),
  ].filter(Boolean));
}

/** Birden fazla token secilince alttaki toplu islem cubugu */
function renderSelectionBar(st) {
  const bar = $("#selBar");
  const s = st.scene;
  const ids = board.selectedIds.filter((id) => s && s.tokens.some((t) => t.id === id));
  if (ids.length < 2) { bar.hidden = true; return; }
  const me = st.you;
  const tokens = ids.map((id) => s.tokens.find((t) => t.id === id));
  const allHidden = tokens.every((t) => t.hidden);
  bar.hidden = false;
  fill(bar,
    h("b", `${ids.length} token seçili`),
    me.isDm ? h("button.btn.small", { type: "button", onClick: () => ids.forEach((id) => app.send({ t: "token.update", id, fields: { hidden: !allHidden } })) },
      allHidden ? "Göster" : "Gizle") : null,
    me.isDm ? h("button.btn.small", { type: "button", onClick: () => app.send({ t: "combat.add", ids }) }, "Savaşa ekle") : null,
    h("button.btn.small.danger", {
      type: "button",
      onClick: () => { if (confirm(`${ids.length} token silinsin mi? (Ctrl+Z ile geri alınır)`)) app.deleteTokens(ids); },
    }, "Sil"),
    h("button.btn.small.ghost", { type: "button", onClick: () => board.select(null) }, "Bırak"));
}

/* ---------------- Giris ekrani ---------------- */

let asDm = false;
let chosenColor = null;

function buildLoginColors() {
  try { chosenColor = localStorage.getItem(COLOR_KEY); } catch { /* yok */ }
  if (!PALETTE.includes(chosenColor)) chosenColor = PALETTE[Math.floor(Math.random() * PALETTE.length)];
  $("#loginColors").replaceChildren(...PALETTE.map((c) => h("button.swatch", {
    type: "button", title: c, class: c === chosenColor ? "on" : "", style: { background: c },
    onClick: (e) => {
      chosenColor = c;
      $$("#loginColors .swatch").forEach((x) => x.classList.remove("on"));
      e.currentTarget.classList.add("on");
    },
  })));
}

function setDmMode(on) {
  asDm = on;
  $("#dmBox").hidden = !on;
  $("#dmToggle").textContent = on ? "Oyuncu olarak gir" : "Dungeon Master olarak gir";
  $("#loginBtn").textContent = on ? "Masayı yönet" : "Masaya otur";
  if (on) $("#loginPass").focus();
}

function showLogin(error) {
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#loginBtn").disabled = false;
  $("#loginError").textContent = error || "";
  try { $("#loginName").value = $("#loginName").value || localStorage.getItem(NAME_KEY) || ""; } catch { /* yok */ }
  fetch("/api/info").then((r) => r.json()).then((info) => {
    const parts = [];
    parts.push(info.dmOnline ? "DM masada" : "DM henüz gelmedi");
    if (info.players.length) parts.push("Oyuncular: " + info.players.join(", "));
    $("#loginInfo").textContent = parts.join(" · ");
  }).catch(() => { $("#loginInfo").textContent = ""; });
}

function showApp() {
  if (!$("#login").hidden) $("#app").classList.toggle("side-closed", window.matchMedia("(max-width: 760px)").matches);
  $("#login").hidden = true;
  $("#app").hidden = false;
  board.requestRender();
}

$("#dmToggle").addEventListener("click", () => setDmMode(!asDm));

$("#loginForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("#loginName").value.trim();
  if (!name) { $("#loginError").textContent = "Bir isim yaz."; return; }
  if (asDm && !$("#loginPass").value) { $("#loginError").textContent = "DM şifresini yaz."; $("#loginPass").focus(); return; }
  try { localStorage.setItem(NAME_KEY, name); localStorage.setItem(COLOR_KEY, chosenColor); } catch { /* yok */ }
  $("#loginError").textContent = "";
  $("#loginBtn").disabled = true;
  net.stop();
  net.start({ t: "join", name, color: chosenColor, asDm, password: $("#loginPass").value });
});

$("#logoutBtn").addEventListener("click", () => {
  if (!confirm("Masadan çıkmak istiyor musun? Aynı isimle tekrar girersen karakterin seni bekliyor olacak.")) return;
  net.stop();
  clearSession();
  app.state = null;
  showLogin();
});

/* ---------------- Sekmeler ---------------- */

app.openTab = (name) => openTab(name);

function openTab(name) {
  $("#app").classList.remove("side-closed");
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".panel").forEach((p) => p.classList.toggle("active", p.id === "panel-" + name));
  if (name === "chat") {
    chat.clearUnread();
    const log = $("#chatLog");
    log.scrollTop = log.scrollHeight;
  }
}

$$(".tab").forEach((t) => t.addEventListener("click", () => openTab(t.dataset.tab)));

// Dar ekranda panel haritanin ustune acilir; genislik degisince varsayilana don
window.matchMedia("(max-width: 760px)").addEventListener("change", (e) => {
  $("#app").classList.toggle("side-closed", e.matches);
});

$("#sideToggle").addEventListener("click", () => {
  $("#app").classList.toggle("side-closed");
  if (app.isTabOpen("chat")) chat.clearUnread();
});

/* ---------------- Araclar ---------------- */

function setTool(name) {
  if ((name === "fog" || name === "wall") && !(app.state && app.state.you.isDm)) return;
  board.setTool(name);
  $$(".tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === name));
  for (const o of ["draw", "fog", "measure", "wall", "template"]) $("#opt-" + o).hidden = name !== o;
  const hints = {
    ping: "Haritada bir yere tıkla — herkes görür",
    wall: "Tıkla tıkla duvar çiz · çift tık, Enter ya da sağ tık bitirir · Esc iptal",
    template: "Başlangıç noktasından sürükle · kendi şablonuna tıklarsan silinir",
  };
  $("#hint").hidden = !hints[name];
  $("#hint").textContent = hints[name] || "";
}

$$(".tool").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
setTool("select");

// Cizim secenekleri
$("#drawColors").replaceChildren(...[...PALETTE, "#ffffff", "#111111"].map((c) => h("button.swatch", {
  type: "button", class: c === board.drawOpts.color ? "on" : "", style: { background: c },
  onClick: (e) => {
    board.drawOpts.color = c;
    board.drawOpts.erase = false;
    $("#drawModePen").classList.add("on");
    $("#drawModeErase").classList.remove("on");
    $$("#drawColors .swatch").forEach((x) => x.classList.remove("on"));
    e.currentTarget.classList.add("on");
  },
})));
$$("#drawWidth button").forEach((b) => b.addEventListener("click", () => {
  board.drawOpts.width = Number(b.dataset.w);
  $$("#drawWidth button").forEach((x) => x.classList.toggle("on", x === b));
}));
$("#drawModePen").addEventListener("click", () => {
  board.drawOpts.erase = false;
  $("#drawModePen").classList.add("on"); $("#drawModeErase").classList.remove("on");
});
$("#drawModeErase").addEventListener("click", () => {
  board.drawOpts.erase = true;
  $("#drawModeErase").classList.add("on"); $("#drawModePen").classList.remove("on");
});
$("#drawClearMine").addEventListener("click", () => app.send({ t: "draw.clear" }));
$("#drawClearAll").addEventListener("click", () => {
  if (confirm("Herkesin çizimleri silinsin mi?")) app.send({ t: "draw.clear", all: true });
});

// Sis secenekleri
$("#fogEnabled").addEventListener("change", (e) => app.send({ t: "fog.toggle", enabled: e.target.checked }));
$("#fogModeReveal").addEventListener("click", () => {
  board.fogOpts.mode = "reveal";
  $("#fogModeReveal").classList.add("on"); $("#fogModeHide").classList.remove("on");
});
$("#fogModeHide").addEventListener("click", () => {
  board.fogOpts.mode = "hide";
  $("#fogModeHide").classList.add("on"); $("#fogModeReveal").classList.remove("on");
});
$("#fogUndo").addEventListener("click", () => app.send({ t: "fog.undo" }));

// Duvar secenekleri
for (const [id, mode] of [["wallModeWall", "wall"], ["wallModeDoor", "door"], ["wallModeErase", "erase"]]) {
  $("#" + id).addEventListener("click", () => {
    board.finishWall();
    board.wallOpts.mode = mode;
    $$("#opt-wall .seg button").forEach((b) => b.classList.toggle("on", b.id === id));
  });
}
$("#wallSnap").addEventListener("change", (e) => { board.wallOpts.snap = e.target.checked; });
$("#visionEnabled").addEventListener("change", (e) => app.send({ t: "vision.set", enabled: e.target.checked }));
$("#visionDark").addEventListener("change", (e) => app.send({ t: "vision.set", dark: e.target.checked }));
$("#wallClear").addEventListener("click", () => {
  if (confirm("Bu sahnedeki tüm duvarlar ve kapılar silinsin mi?")) app.send({ t: "wall.clear" });
});

// Sablon secenekleri
$$("#templateShapes button").forEach((b) => b.addEventListener("click", () => {
  board.templateOpts.shape = b.dataset.shape;
  $$("#templateShapes button").forEach((x) => x.classList.toggle("on", x === b));
}));
$("#templateClear").addEventListener("click", () => app.send({ t: "template.clear" }));
$("#templateColors").replaceChildren(
  h("button.swatch.mine", { type: "button", class: "on", title: "Kendi rengim", onClick: (e) => pickTemplateColor(null, e) }),
  ...[...PALETTE, "#ffffff", "#111111"].map((c) => h("button.swatch", { type: "button", style: { background: c }, onClick: (e) => pickTemplateColor(c, e) })));
function pickTemplateColor(c, e) {
  board.templateOpts.color = c;
  $$("#templateColors .swatch").forEach((x) => x.classList.remove("on"));
  e.currentTarget.classList.add("on");
}
$("#fogRevealAll").addEventListener("click", () => app.send({ t: "fog.reset", mode: "reveal" }));
$("#fogHideAll").addEventListener("click", () => {
  if (confirm("Tüm harita sisle kapatılsın mı?")) app.send({ t: "fog.reset", mode: "hide" });
});

// Yakinlastirma
$$("[data-zoom]").forEach((b) => b.addEventListener("click", () => {
  const z = b.dataset.zoom;
  if (z === "in") board.zoomBy(1.25);
  else if (z === "out") board.zoomBy(0.8);
  else board.fit();
}));

$("#pillNext").addEventListener("click", () => app.send({ t: "combat.next" }));

/* ---------------- Klavye ---------------- */

function typing(e) {
  const t = e.target;
  return t && (t.matches("input, textarea, select") || t.isContentEditable);
}

document.addEventListener("keydown", (e) => {
  if (!app.state || $("#app").hidden || isModalOpen() || typing(e)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { app.undo(); e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && copyTemplate()) { e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && pasteTemplate()) { e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && app.state.scene) {
    const me = app.state.you;
    board.selectMany(app.state.scene.tokens.filter((t) => me.isDm || t.ownerId === me.id).map((t) => t.id));
    e.preventDefault();
    return;
  }
  if (e.ctrlKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  const tools = { v: "select", m: "measure", d: "draw", p: "ping", f: "fog", w: "wall", t: "template" };
  if (tools[k]) { setTool(tools[k]); e.preventDefault(); return; }
  if (e.key === " ") { board.setSpace(true); e.preventDefault(); return; }
  if (e.key === "Enter" && board.drawingWall) { board.finishWall(); e.preventDefault(); return; }
  if (e.key === "Escape" && board.drawingWall) { board.cancelWall(); return; }
  if (e.key === "Escape") { board.cancel(); board.select(null); board.selectTemplate(null); app.closeCard(); setTool("select"); return; }
  if (e.key === "+" || e.key === "=") { board.zoomBy(1.25); return; }
  if (e.key === "-") { board.zoomBy(0.8); return; }
  if (e.key === "0") { board.fit(); return; }
  if (e.key === "Enter") { openTab("chat"); $("#chatInput").focus(); e.preventDefault(); return; }
  if (e.key === "Delete" || e.key === "Backspace") {
    const tpl = selectedTemplate();
    if (tpl) { app.send({ t: "template.delete", id: tpl.id }); e.preventDefault(); return; }
    const ids = board.selectedIds;
    if (ids.length) app.deleteTokens(ids); // Ctrl+Z ile geri alinabildigi icin soru sormadan
    e.preventDefault();
  }
});

document.addEventListener("keyup", (e) => { if (e.key === " ") board.setSpace(false); });
window.addEventListener("blur", () => board.setSpace(false));

/* ---------------- Baslangic ---------------- */

buildLoginColors();
const saved = loadSession();
if (saved) {
  $("#loginBtn").disabled = true;
  $("#loginInfo").textContent = "Masaya yeniden bağlanılıyor…";
  net.start({ t: "join", secret: saved });
} else {
  showLogin();
}
