// D&D Sanal Masa - sunucu
// Kullanim: node server/index.js [--port=8080] [--dm=sifre] [--internet | --yerel] [--nobrowser] [--data=klasor]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { randomBytes } from "node:crypto";
import { WebSocketServer } from "ws";
import { Store, newId, newSecret, sceneView, chatVisible, normalize } from "./state.js";
import { createActions, ActionError } from "./actions.js";
import { loadConfig } from "./config.js";
import { startTunnel } from "./tunnel.js";
import { Backups } from "./backup.js";
import { IS_PACKAGED, ROOT, DATA_ROOT, readStatic, listStatic } from "./files.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
// Indirilen tek dosyalik program: cift tiklayan cogunlukla baska aglardaki arkadaslariyla oynar,
// bu yuzden internete acma varsayilan. Sadece ayni evde oynamak icin: --yerel
if (IS_PACKAGED && !args.yerel) args.internet = true;

const PORT = Number(args.port || process.env.PORT || 8080);
const MAX_UPLOAD = 30 * 1024 * 1024;
const MAX_PLAYERS = 12;
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const AUDIO_EXT = new Set([".mp3", ".ogg", ".wav", ".m4a", ".webm"]);

const DIRS = {
  uploads: path.join(DATA_ROOT, "uploads"),
  data: args.data ? path.resolve(String(args.data)) : path.join(DATA_ROOT, "data"), // testler icin ayri kayit klasoru
};
for (const sub of ["maps", "tokens", "audio"]) fs.mkdirSync(path.join(DIRS.uploads, sub), { recursive: true });

const config = loadConfig(DIRS.data);
const DM_PASSWORD = String(args.dm || process.env.DM_PASSWORD || config.dmSifresi);
let publicUrl = null;

/* ------------------------------------------------------------------ */
/* Gorsel kutuphanesi                                                  */
/* ------------------------------------------------------------------ */

function prettyName(file) {
  const base = path.basename(file, path.extname(file));
  return base.replace(/-[0-9a-f]{6}$/, "").replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function listImages(kind) {
  const out = [];
  const exts = kind === "audio" ? AUDIO_EXT : IMAGE_EXT;
  for (const base of ["assets", "uploads"]) {
    let files = [];
    if (base === "assets") files = listStatic("assets", kind);
    else try { files = fs.readdirSync(path.join(DIRS.uploads, kind)); } catch { continue; }
    for (const f of files) {
      if (!exts.has(path.extname(f).toLowerCase())) continue;
      out.push({ url: `/${base}/${kind}/${encodeURIComponent(f)}`, name: prettyName(f), uploaded: base === "uploads" });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Durum                                                               */
/* ------------------------------------------------------------------ */

const backups = new Backups(DIRS.data);
const store = new Store(path.join(DIRS.data, "masa.json"), listImages("maps"), (data) => backups.maybe(data));
migrateAssetUrls();
const clients = new Set(); // { ws, playerId, cid, voice }

/**
 * Eski surumlerdeki hazir gorseller (/assets/...) programdan cikarildi. Kayitta bu adresler varsa
 * ve ayni dosya uploads/ altinda duruyorsa adresi oraya cevir; yoksa gorseli bos birak.
 */
function migrateAssetUrls() {
  let changed = 0;
  const fix = (url) => {
    if (typeof url !== "string" || !url.startsWith("/assets/")) return url;
    const rel = url.slice("/assets/".length);
    if (readStatic("assets", decodeURIComponent(rel))) return url;
    changed++;
    return fs.existsSync(path.join(DIRS.uploads, decodeURIComponent(rel))) ? "/uploads/" + rel : null;
  };
  for (const s of store.data.scenes) {
    s.map = fix(s.map);
    for (const t of s.tokens) t.img = fix(t.img);
  }
  if (store.data.handout && store.data.handout.img) {
    store.data.handout.img = fix(store.data.handout.img);
    if (!store.data.handout.img) store.data.handout = null;
  }
  if (changed) {
    store.saveNow();
    console.log(`  ${changed} eski gorsel adresi guncellendi.`);
  }
}

/** Yedekten ya da iceri aktarmadan gelen masayi yukler; oyuncu oturumlari korunur. */
function replaceData(incoming, byPlayer) {
  if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.scenes)) {
    throw new ActionError("Bu dosya bir masa kaydı değil.");
  }
  store.saveNow();
  backups.write(store.data, "once");
  const players = store.data.players;
  const data = normalize({ ...incoming, formatVersion: 2 });
  data.players = players;
  store.data = data;
  store.saveNow();
  broadcastState();
  resendChat();
  console.log(`  Masa geri yuklendi (${byPlayer ? byPlayer.name : "?"}).`);
}

function viewFor(player) {
  const d = store.data;
  const online = new Set([...clients].map((c) => c.playerId));
  return {
    you: { id: player.id, name: player.name, color: player.color, isDm: player.isDm },
    players: d.players.map((p) => ({ id: p.id, name: p.name, color: p.color, isDm: p.isDm, online: online.has(p.id), stats: p.stats || null })),
    handout: d.handout || null,
    music: d.music || null,
    activeSceneId: d.activeSceneId,
    scenes: player.isDm ? d.scenes.map((s) => ({ id: s.id, name: s.name, map: s.map })) : [],
    scene: sceneView(store.activeScene, player),
  };
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
}

function broadcastState() {
  const cache = new Map();
  for (const c of clients) {
    const p = store.player(c.playerId);
    if (!p) continue;
    if (!cache.has(p.id)) cache.set(p.id, JSON.stringify({ t: "state", state: viewFor(p) }));
    send(c.ws, cache.get(p.id));
  }
}

function broadcastTo(filter, msg) {
  const raw = JSON.stringify(msg);
  for (const c of clients) {
    const p = store.player(c.playerId);
    if (p && filter(p)) send(c.ws, raw);
  }
}

function pushChat(msg) {
  store.addChat(msg);
  broadcastTo((p) => chatVisible(msg, p), { t: "chat", msg });
}

// Zar istatistikleri sik degisir; durumu kisa bir gecikmeyle toplu yayinla
let statsTimer = null;
function statsChanged() {
  store.save();
  clearTimeout(statsTimer);
  statsTimer = setTimeout(broadcastState, 600);
}

function resendChat() {
  for (const c of clients) {
    const p = store.player(c.playerId);
    if (p) send(c.ws, { t: "chatAll", chat: store.data.chat.filter((m) => chatVisible(m, p)) });
  }
}

function disconnectPlayer(playerId, reason) {
  for (const c of [...clients]) {
    if (c.playerId !== playerId) continue;
    send(c.ws, { t: "kicked", reason });
    c.ws.close(4001, "kicked");
    clients.delete(c);
  }
}

/* ------------------------------------------------------------------ */
/* Giris                                                               */
/* ------------------------------------------------------------------ */

const PALETTE = ["#e05d5d", "#4f9be0", "#59b86b", "#d9a43c", "#a46be0", "#3cc6c0", "#e07d3c", "#d65fa8"];

function join(client, m) {
  const d = store.data;
  let player = null;
  let isNew = false;

  if (typeof m.secret === "string" && m.secret) {
    player = d.players.find((p) => p.secret === m.secret) || null;
    if (!player && !m.name) throw new ActionError("Oturumun sona ermiş, tekrar giriş yap.");
  }

  if (!player) {
    const name = typeof m.name === "string" ? m.name.trim().slice(0, 24) : "";
    if (!name) throw new ActionError("Bir isim yaz.");

    if (m.asDm) {
      if (m.password !== DM_PASSWORD) {
        throw new ActionError("DM şifresi yanlış. Şifre, masayı açan bilgisayardaki siyah pencerede \"DM sifresi\" satırında yazar (ya da SanalMasa-Veri/data/ayarlar.json dosyasında).");
      }
      player = d.players.find((p) => p.isDm) || null;
      if (player) player.name = name;
    } else {
      const same = d.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (same && same.isDm) throw new ActionError("Bu isim DM'e ait, başka bir isim seç.");
      if (same) {
        // Ayni isimle geri donen oyuncu eski karakterini geri alir
        if ([...clients].some((c) => c.playerId === same.id)) throw new ActionError("Bu isimde biri zaten masada.");
        player = same;
      }
    }

    if (!player) {
      if (d.players.filter((p) => !p.isDm).length >= MAX_PLAYERS && !m.asDm) throw new ActionError("Masa dolu.");
      const used = new Set(d.players.map((p) => p.color));
      player = {
        id: newId(m.asDm ? "dm" : "pl"),
        name,
        isDm: !!m.asDm,
        color: /^#[0-9a-f]{6}$/i.test(m.color || "") ? m.color : PALETTE.find((c) => !used.has(c)) || PALETTE[0],
        secret: newSecret(),
      };
      d.players.push(player);
      isNew = true;
    }
    if (/^#[0-9a-f]{6}$/i.test(m.color || "")) player.color = m.color;
  }

  client.playerId = player.id;
  store.save();
  if (client.voice) broadcastVoiceRoster();
  send(client.ws, {
    t: "welcome",
    secret: player.secret,
    cid: client.cid,
    state: viewFor(player),
    chat: d.chat.filter((msg) => chatVisible(msg, player)),
  });
  if (isNew) {
    pushChat({ id: newId("m"), ts: Date.now(), type: "system", text: `${player.name} masaya katıldı${player.isDm ? " (DM)" : ""}.` });
  }
  broadcastState();
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".webm": "audio/webm",
  ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8",
};

function dmFromRequest(req) {
  const p = store.data.players.find((x) => x.secret && x.secret === req.headers["x-session"]);
  return p && p.isDm ? p : null;
}

function readBody(req, limit, cb) {
  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > limit) { req.destroy(); cb(new Error("too big")); return; }
    chunks.push(c);
  });
  req.on("end", () => { if (size <= limit) cb(null, Buffer.concat(chunks)); });
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

/** public/ ve assets/ (paketli programda programin icinden) */
function serveStatic(res, base, rel, cache) {
  let decoded;
  try { decoded = decodeURIComponent(rel); } catch { return json(res, 400, { error: "Geçersiz yol" }); }
  const body = readStatic(base, decoded);
  if (!body) return json(res, 404, { error: "Bulunamadı" });
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(decoded).toLowerCase()] || "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": cache ? "public, max-age=86400" : "no-cache",
  });
  res.end(body);
}

function serveFile(res, baseDir, rel, cache) {
  let decoded;
  try { decoded = decodeURIComponent(rel); } catch { return json(res, 400, { error: "Geçersiz yol" }); }
  const file = path.normalize(path.join(baseDir, decoded));
  if (!file.startsWith(baseDir + path.sep) && file !== baseDir) return json(res, 403, { error: "Yasak" });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return json(res, 404, { error: "Bulunamadı" });
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": cache ? "public, max-age=86400" : "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  });
}

function handleUpload(req, res, url) {
  const player = store.data.players.find((p) => p.secret && p.secret === req.headers["x-session"]);
  if (!player) return json(res, 401, { error: "Önce masaya katıl." });
  const k = url.searchParams.get("kind");
  const kind = k === "maps" || k === "audio" ? k : "tokens";
  if (kind !== "tokens" && !player.isDm) return json(res, 403, { error: "Bunu sadece DM yükleyebilir." });

  const original = String(url.searchParams.get("name") || "gorsel.png");
  const ext = path.extname(original).toLowerCase();
  if (kind === "audio" && !AUDIO_EXT.has(ext)) return json(res, 400, { error: "Sadece MP3, OGG, WAV veya M4A yüklenebilir." });
  if (kind !== "audio" && !IMAGE_EXT.has(ext)) return json(res, 400, { error: "Sadece PNG, JPG, WEBP veya GIF yüklenebilir." });

  const TR = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", Ç: "C", Ğ: "G", İ: "I", Ö: "O", Ş: "S", Ü: "U" };
  const base = path.basename(original, path.extname(original))
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => TR[c])
    .normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "gorsel";
  const fileName = `${base}-${randomBytes(3).toString("hex")}${ext}`;
  const target = path.join(DIRS.uploads, kind, fileName);

  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_UPLOAD) {
      aborted = true;
      json(res, 413, { error: "Dosya çok büyük (en fazla 30 MB)." });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (aborted) return;
    if (!size) return json(res, 400, { error: "Dosya boş." });
    fs.writeFile(target, Buffer.concat(chunks), (err) => {
      if (err) return json(res, 500, { error: "Kaydedilemedi." });
      json(res, 200, { url: `/uploads/${kind}/${encodeURIComponent(fileName)}`, name: prettyName(fileName) });
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  if (req.method === "POST" && p === "/api/upload") return handleUpload(req, res, url);
  if (req.method === "POST" && p === "/api/import") {
    const dm = dmFromRequest(req);
    if (!dm) return json(res, 403, { error: "Bunu sadece DM yapabilir." });
    return readBody(req, 50 * 1024 * 1024, (err, body) => {
      if (err) return json(res, 413, { error: "Dosya çok büyük." });
      try {
        replaceData(JSON.parse(body.toString("utf8")), dm);
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, 400, { error: e instanceof ActionError ? e.message : "Dosya okunamadı (JSON değil)." });
      }
    });
  }
  if (p === "/api/export") {
    const dm = dmFromRequest(req);
    if (!dm) return json(res, 403, { error: "Bunu sadece DM yapabilir." });
    const { players, ...rest } = store.data; // oyuncu oturum anahtarlari disa verilmez
    res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
    return res.end(JSON.stringify(rest));
  }
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Desteklenmiyor" });

  if (p === "/api/library") return json(res, 200, { maps: listImages("maps"), tokens: listImages("tokens"), audio: listImages("audio") });
  if (p === "/api/info") {
    return json(res, 200, {
      dmOnline: [...clients].some((c) => store.player(c.playerId)?.isDm),
      players: store.data.players.filter((x) => !x.isDm).map((x) => x.name),
      publicUrl,
      iceServers: config.iceServers,
    });
  }
  if (p.startsWith("/assets/")) return serveStatic(res, "assets", p.slice(8), true);
  if (p.startsWith("/uploads/")) return serveFile(res, DIRS.uploads, p.slice(9), true);
  return serveStatic(res, "public", p === "/" ? "index.html" : p.slice(1), false);
});

/* ------------------------------------------------------------------ */
/* WebSocket                                                           */
/* ------------------------------------------------------------------ */

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

server.on("upgrade", (req, socket, head) => {
  if (new URL(req.url, "http://x").pathname !== "/ws") return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
});

wss.on("connection", (ws) => {
  const client = { ws, playerId: null, alive: true, cid: newId("c"), voice: false };
  clients.add(client);

  const actions = createActions({
    store, pushChat, broadcastTo, resendChat, disconnectPlayer, statsChanged, backups, replaceData,
    reply: (msg) => send(ws, msg),
  });

  ws.on("pong", () => { client.alive = true; });

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== "string") return;

    try {
      if (m.t === "join") return join(client, m);
      const player = store.player(client.playerId);
      if (!player) throw new ActionError("Önce masaya katıl.");
      if (m.t.startsWith("voice.")) return handleVoice(client, player, m);
      const fn = actions[m.t];
      if (!fn) throw new ActionError("Bilinmeyen komut.");
      const result = fn(player, m);
      if (result === "state") {
        store.save();
        broadcastState();
      }
    } catch (err) {
      if (!(err instanceof ActionError)) console.error("  [!] Hata:", m.t, err);
      send(ws, { t: "error", message: err instanceof ActionError ? err.message : "Sunucu hatası.", fatal: m.t === "join" });
    }
  });

  ws.on("close", () => {
    clients.delete(client);
    if (client.voice) broadcastVoiceRoster();
    if (client.playerId) {
      broadcastTo((p) => p.id !== client.playerId, { t: "measure", id: client.playerId, line: null });
      broadcastState();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Sesli sohbet (WebRTC sinyallesmesi; ses tarayicilar arasinda dogrudan akar) */
/* ------------------------------------------------------------------ */

function broadcastVoiceRoster() {
  const members = [...clients].filter((c) => c.voice && c.playerId).map((c) => ({ cid: c.cid, playerId: c.playerId }));
  broadcastTo(() => true, { t: "voice.roster", members });
}

function handleVoice(client, player, m) {
  if (m.t === "voice.join") {
    const count = [...clients].filter((c) => c.voice).length;
    if (!client.voice && count >= 10) throw new ActionError("Sesli sohbet dolu (en fazla 10 kişi).");
    client.voice = true;
    broadcastVoiceRoster();
  } else if (m.t === "voice.leave") {
    client.voice = false;
    broadcastVoiceRoster();
  } else if (m.t === "voice.signal") {
    const target = [...clients].find((c) => c.cid === m.to && c.voice);
    if (target && client.voice) send(target.ws, { t: "voice.signal", from: client.cid, data: m.data });
  } else if (m.t === "voice.state") {
    broadcastTo(() => true, { t: "voice.state", playerId: player.id, muted: !!m.muted });
  }
}

// Tunellerin baglantiyi bosta diye kapatmamasi ve olu baglantilarin temizlenmesi icin
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false;
    try { c.ws.ping(); } catch { /* kapanmis */ }
  }
}, 25000);

/* ------------------------------------------------------------------ */
/* Baslat                                                              */
/* ------------------------------------------------------------------ */

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  [HATA] ${PORT} portu kullanimda. Masa zaten acik olabilir.`);
    console.error(`         Tarayicida http://localhost:${PORT} adresini dene.\n`);
    if (IS_PACKAGED && !args.nobrowser) openBrowser(`http://localhost:${PORT}`);
  } else {
    console.error("\n  [HATA]", err.message);
  }
  exitAfterKey(1);
});

/** Cift tiklanan programda pencere hemen kapanmasin, kullanici hatayi okuyabilsin */
function exitAfterKey(code) {
  if (!IS_PACKAGED || !process.stdin.isTTY) process.exit(code);
  console.error("  Kapatmak icin Enter'a bas.");
  process.stdin.resume();
  process.stdin.once("data", () => process.exit(code));
}

// Siyah pencerede renkli yazi (Windows 10+ ve Mac/Linux terminalleri destekler)
const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { gold: "\x1b[1;33m", green: "\x1b[1;32m", cyan: "\x1b[36m", dim: "\x1b[2m", reset: "\x1b[0m" }
  : { gold: "", green: "", cyan: "", dim: "", reset: "" };

server.listen(PORT, () => {
  console.log("");
  console.log("  ==========================================");
  console.log(`    ${C.gold}D&D SANAL MASA calisiyor${C.reset}`);
  console.log("  ==========================================");
  console.log(`  Bu bilgisayardan : ${C.cyan}http://localhost:${PORT}${C.reset}`);
  for (const ip of lanAddresses()) console.log(`  Ayni evden (LAN) : ${C.cyan}http://${ip}:${PORT}${C.reset}`);
  console.log(`  DM sifresi       : ${C.gold}${DM_PASSWORD}${C.reset}   ${C.dim}(degistirmek icin: ${path.relative(ROOT, config.file)})${C.reset}`);
  if (IS_PACKAGED) console.log(`  Kayitlar         : ${DATA_ROOT}`);
  console.log("");
  console.log("  Kapatmak icin bu pencereyi kapat (veya Ctrl+C).");
  console.log("");
  backups.write(store.data, "otomatik");
  if (!args.nobrowser) openBrowser(`http://localhost:${PORT}`);
  if (args.internet) {
    console.log("  Internete aciliyor (Cloudflare, hesap gerekmez)...");
    startTunnel({
      port: PORT,
      toolsDir: path.join(DATA_ROOT, "tools"),
      onUrl: (url) => {
        publicUrl = url;
        if (!url) return;
        console.log("");
        console.log("  ************************************************************");
        console.log(`    ${C.gold}ARKADASLARINA BU ADRESI GONDER:${C.reset}`);
        console.log(`    ${C.green}${url}${C.reset}`);
        console.log("  ************************************************************");
        console.log("  (Masadaki 'Davet et' dugmesi de bu adresi kopyalar.)");
        console.log("");
      },
    });
  }
});

function openBrowser(url) {
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => { /* tarayici acilamazsa onemli degil */ });
}

function shutdown() {
  store.saveNow();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("SIGHUP", shutdown); // Windows: konsol penceresi kapatilinca
