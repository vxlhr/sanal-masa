// Gercek tarayicida (Chrome/Edge, gorunmez) uctan uca arayuz testi: DM + oyuncu.
// Kullanim: once  node server/index.js --port=8099 --nobrowser --data=test/veri
//           sonra node test/arayuz-testi.mjs
// Ekran goruntuleri test/ekran/ klasorune yazilir.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = process.env.PORT || 8099;
const BASE = `http://localhost:${PORT}/`;
const DATA = process.env.DATA || "test/veri";
const OUT = "test/ekran";
const W = 1366, H = 800;
fs.mkdirSync(OUT, { recursive: true });
const DM_PASS = JSON.parse(fs.readFileSync(`${DATA}/ayarlar.json`, "utf8")).dmSifresi;

const CANDIDATES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].filter(Boolean);
const CHROME = CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) { console.error("Chrome/Edge bulunamadi. CHROME=... ile yol ver."); process.exit(2); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sanalmasa-test-"));
const proc = spawn(CHROME, [
  "--headless=new", "--remote-debugging-port=9334", `--user-data-dir=${profile}`, "--no-first-run",
  "--hide-scrollbars", `--window-size=${W},${H}`,
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required",
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ver;
for (let i = 0; i < 60 && !ver; i++) {
  try { ver = await (await fetch("http://127.0.0.1:9334/json/version")).json(); } catch { await sleep(200); }
}

const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pending = new Map();
const consoleErrors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") consoleErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
});
const cmd = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, (m) => (m.error ? rej(new Error(method + ": " + m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

async function page(name) {
  const { browserContextId } = await cmd("Target.createBrowserContext");
  const { targetId } = await cmd("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await cmd("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => cmd(m, p, sessionId);
  await s("Page.enable"); await s("Runtime.enable");
  await s("Page.addScriptToEvaluateOnNewDocument", { source: "window.confirm = () => true;" });
  await s("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await s("Page.navigate", { url: BASE });
  await sleep(1200);
  return {
    async eval(expr) {
      const r = await s("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) throw new Error(name + ": " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async shot(file) {
      const r = await s("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(OUT, file), Buffer.from(r.data, "base64"));
    },
    async mouse(type, x, y, extra = {}) {
      await s("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
    },
    async click(x, y, modifiers = 0) {
      await this.mouse("mousePressed", x, y, { modifiers });
      await this.mouse("mouseReleased", x, y, { modifiers });
      await sleep(80);
    },
    async drag(x1, y1, x2, y2, { steps = 8, hold = false, modifiers = 0 } = {}) {
      await s("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1, y: y1 });
      await this.mouse("mousePressed", x1, y1, { modifiers });
      for (let i = 1; i <= steps; i++) {
        await s("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps, button: "left", buttons: 1, modifiers });
        await sleep(25);
      }
      if (!hold) await this.mouse("mouseReleased", x2, y2, { modifiers });
    },
    async key(key, modifiers = 0) {
      await s("Input.dispatchKeyEvent", { type: "keyDown", key, modifiers, text: key.length === 1 && !modifiers ? key : undefined });
      await s("Input.dispatchKeyEvent", { type: "keyUp", key, modifiers });
      await sleep(80);
    },
    async click$(sel) {
      await this.eval(`(() => { const el = ${sel}; if (!el) throw new Error("bulunamadi: " + ${JSON.stringify(sel)}); el.click(); })()`);
      await sleep(250);
    },
  };
}

let fails = 0;
const ok = (c, label) => { console.log((c ? "  OK  " : "  FAIL") + " " + label); if (!c) fails++; };
const btn = (text) => `[...document.querySelectorAll("button")].find(b => b.offsetParent && b.textContent.trim().includes(${JSON.stringify(text)}))`;
const setVal = (sel, v) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(String(v))}; el.dispatchEvent(new Event("input", {bubbles:true})); el.dispatchEvent(new Event("change", {bubbles:true})); })()`;
const S = "sanalMasa.state.scene";
const screenOf = (who, name) => who.eval(`(() => { const t = ${S}.tokens.find(t => t.name === ${JSON.stringify(name)}); const h = t.size * ${S}.grid.size / 2; return sanalMasa.board.toScreen(t.x + h, t.y + h); })()`);
const worldToScreen = (who, x, y) => who.eval(`sanalMasa.board.toScreen(${x}, ${y})`);

try {
  const dm = await page("dm");
  const pl = await page("pl");

  // Giris
  await dm.click$(`document.querySelector("#dmToggle")`);
  await dm.eval(setVal("#loginName", "Usta"));
  await dm.eval(setVal("#loginPass", DM_PASS));
  await dm.click$(`document.querySelector("#loginBtn")`);
  await sleep(800);
  ok(await dm.eval(`document.body.classList.contains("is-dm")`), "DM logged in");
  await pl.eval(setVal("#loginName", "Ayla"));
  await pl.click$(`document.querySelector("#loginBtn")`);
  await sleep(800);

  // Temiz, haritasiz bir sahne
  await dm.eval(`sanalMasa.send({ t: "scene.create", name: "Arayüz Testi", map: null })`);
  await sleep(800);
  const gs = await dm.eval(`${S}.grid.size`);
  await dm.eval(`sanalMasa.send({ t: "scene.update", id: ${S}.id, grid: { size: 50 } })`);
  await sleep(300);
  const g = 50;

  await pl.eval(`sanalMasa.send({ t: "token.create", name: "Ayla", x: ${g * 6.5}, y: ${g * 6.5}, maxHp: 20 })`);
  for (const [n, cx] of [["Goblin 1", 14.5], ["Goblin 2", 15.5], ["Goblin 3", 16.5]]) {
    await dm.eval(`sanalMasa.send({ t: "token.create", name: ${JSON.stringify(n)}, kind: "monster", x: ${g * cx}, y: ${g * 6.5}, maxHp: 7 })`);
  }
  await sleep(500);
  for (const who of [dm, pl]) {
    await who.eval(`(() => { const b = sanalMasa.board; b.fit(); b.zoomBy(0.8); b.centerOn(${S}.tokens.find(t => t.name === "Ayla")); b.select(null); })()`);
  }
  await sleep(300);

  // Duvar araci: Ayla ile goblinler arasina duvar
  await dm.key("w");
  const a = await worldToScreen(dm, g * 10, g * 2);
  const b = await worldToScreen(dm, g * 10, g * 11);
  await dm.click(a.x, a.y);
  await dm.click(b.x, b.y);
  await dm.key("Enter");
  await sleep(400);
  ok((await dm.eval(`${S}.walls.length`)) === 1, "wall drawn with wall tool");
  await dm.click$(`document.querySelector("#visionEnabled").parentElement`);
  await sleep(500);
  ok(await dm.eval(`${S}.vision.enabled`), "dynamic vision enabled");
  ok((await pl.eval(`${S}.tokens.filter(t => t.name.startsWith("Goblin")).length`)) === 0, "player cannot see goblins behind wall");
  await dm.shot("01-dm-duvar-gorus.png");
  await pl.shot("02-oyuncu-gorus.png");

  // Kapi: duvari sil, kapi yap, DM acar
  await dm.eval(`sanalMasa.send({ t: "wall.clear" })`);
  await dm.click$(`document.querySelector("#wallModeDoor")`);
  await dm.click(a.x, a.y);
  await dm.click(b.x, b.y);
  await sleep(400);
  const door = await dm.eval(`${S}.walls[0]`);
  ok(door && door.door, "door drawn");
  await dm.key("v");
  const mid = await worldToScreen(dm, g * 10, g * 6.5);
  await dm.click(mid.x, mid.y);
  await sleep(400);
  ok(await dm.eval(`${S}.walls[0].open`), "DM clicks door to open it");
  ok((await pl.eval(`${S}.tokens.filter(t => t.name.startsWith("Goblin")).length`)) === 3, "open door: player sees goblins");
  await pl.shot("03-oyuncu-kapi-acik.png");

  // Karanlik + mesale
  await dm.eval(`sanalMasa.send({ t: "vision.set", dark: true })`);
  await sleep(300);
  ok((await pl.eval(`${S}.tokens.filter(t => t.name.startsWith("Goblin")).length`)) === 0, "dark: goblins invisible");
  const aylaId = await pl.eval(`${S}.tokens.find(t => t.name === "Ayla").id`);
  await pl.eval(`sanalMasa.openCard(${JSON.stringify(aylaId)})`);
  await sleep(300);
  await pl.eval(`(() => { const s = document.querySelectorAll("#tokenCard .sight select")[0]; s.value = "60"; s.dispatchEvent(new Event("change")); })()`);
  await sleep(500);
  ok((await pl.eval(`${S}.tokens.filter(t => t.name.startsWith("Goblin")).length`)) >= 1, "torch light (60 ft) from token card reveals goblins");
  await pl.shot("04-oyuncu-mesale.png");
  await dm.eval(`sanalMasa.send({ t: "vision.set", enabled: false, dark: false })`);
  await pl.eval(`sanalMasa.board.select(null)`);
  await sleep(300);

  // Coklu secim (Shift + kutu) ve toplu tasima + geri al
  await dm.key("v");
  await dm.eval(`sanalMasa.board.select(null)`);
  const g1 = await screenOf(dm, "Goblin 1");
  const g3 = await screenOf(dm, "Goblin 3");
  await dm.drag(g1.x - 40, g1.y - 40, g3.x + 40, g3.y + 40, { modifiers: 8 });
  await sleep(300);
  ok((await dm.eval(`sanalMasa.board.selectedIds.length`)) === 3, "shift-drag box selects 3 goblins");
  ok(await dm.eval(`!document.querySelector("#selBar").hidden`), "selection bar visible");
  await dm.shot("05-coklu-secim.png");
  const before = await dm.eval(`${S}.tokens.filter(t => t.name.startsWith("Goblin")).map(t => t.x)`);
  const g2 = await screenOf(dm, "Goblin 2");
  await dm.drag(g2.x, g2.y, g2.x, g2.y + 120);
  await sleep(500);
  const after = await dm.eval(`${S}.tokens.filter(t => t.name.startsWith("Goblin")).map(t => t.y)`);
  ok(new Set(after).size === 1 && after[0] > g * 6.5, "group drag moves all three (y: " + after.join(",") + ")");
  await dm.key("z", 2);
  await sleep(500);
  const undone = await dm.eval(`${S}.tokens.filter(t => t.name.startsWith("Goblin")).map(t => t.y)`);
  ok(undone.every((y) => Math.abs(y - g * 6) < 1), "Ctrl+Z undoes group move");

  // Silme + geri al
  await dm.key("Delete");
  await sleep(400);
  ok((await dm.eval(`${S}.tokens.filter(t => t.name.startsWith("Goblin")).length`)) === 0, "Delete removes selected tokens");
  await dm.key("z", 2);
  await sleep(500);
  ok((await dm.eval(`${S}.tokens.filter(t => t.name.startsWith("Goblin")).length`)) === 3, "Ctrl+Z restores deleted tokens");

  // Tek tik secer ama kart acmaz, cift tik acar
  await dm.key("v");
  await dm.eval(`sanalMasa.board.select(null); sanalMasa.closeCard()`);
  const gg = await screenOf(dm, "Goblin 1");
  await dm.click(gg.x, gg.y);
  await sleep(450);
  ok(await dm.eval(`document.querySelector("#tokenCard").hidden && sanalMasa.board.selectedId !== null`), "single click selects without opening card");
  await dm.click(gg.x, gg.y);
  await dm.click(gg.x, gg.y);
  await sleep(300);
  ok(await dm.eval(`!document.querySelector("#tokenCard").hidden`), "double click opens token card");
  await dm.eval(`sanalMasa.closeCard(); sanalMasa.board.select(null)`);

  // Alan sablonu (oyuncu): goblinlerin uzerine 10 ft daire
  await pl.key("t");
  const pg2 = await screenOf(pl, "Goblin 2");
  const scale = await pl.eval(`sanalMasa.board.toScreen(1, 0).x - sanalMasa.board.toScreen(0, 0).x`);
  await pl.drag(pg2.x, pg2.y, pg2.x + g * 2 * scale, pg2.y);
  await sleep(400);
  const tpl = await pl.eval(`${S}.templates[0]`);
  ok(tpl && tpl.shape === "circle" && tpl.size === 10, "template placed: 10 ft circle");
  await pl.shot("06-sablon.png");
  // Secim araciyla tut, surukle, rengini degistir, kopyala-yapistir
  await pl.key("v");
  const tc = await worldToScreen(pl, tpl.x, tpl.y);
  await pl.drag(tc.x + 5, tc.y + 5, tc.x + 5, tc.y + 105);
  await sleep(400);
  const tplMoved = await pl.eval(`${S}.templates[0]`);
  ok(tplMoved.y > tpl.y + 20, "template dragged with select tool");
  ok(await pl.eval(`!document.querySelector("#tplBar").hidden`), "template bar shown for selected template");
  await pl.click$(`document.querySelectorAll("#tplBar .swatch")[2]`);
  await sleep(300);
  ok((await pl.eval(`${S}.templates[0].color`)) !== tpl.color, "template color changed from bar");
  await pl.shot("06b-sablon-secili.png");
  await pl.key("c", 2);
  await pl.mouse("mouseMoved", tc.x + 200, tc.y);
  await pl.key("v", 2);
  await sleep(400);
  ok((await pl.eval(`${S}.templates.length`)) === 2, "Ctrl+C / Ctrl+V duplicates template");
  await pl.eval(`sanalMasa.send({ t: "template.clear" })`);
  await sleep(300);

  // Karakter kagidi: saldiri ekle ve saldir
  await pl.eval(`sanalMasa.openCard(${JSON.stringify(aylaId)})`);
  await sleep(300);
  await pl.click$(btn("Karakter kağıdı"));
  await sleep(300);
  await pl.click$(btn("+ Saldırı ekle"));
  await pl.click$(btn("+ Büyü ekle"));
  await pl.eval(`(() => { const i = document.querySelectorAll(".slot-max")[0]; i.value = 2; i.dispatchEvent(new Event("change")); })()`);
  await sleep(200);
  await pl.shot("07-karakter-kagidi.png");
  await pl.click$(btn("⚔ Saldır"));
  await sleep(700);
  const atk = await dm.eval(`[...document.querySelectorAll("#chatLog .msg")].map(m => m.textContent).filter(t => t.includes("Yeni saldırı")).length`);
  ok(atk >= 1, "attack from sheet posts roll(s)");
  await pl.click$(btn("✨ Kullan"));
  await sleep(500);
  ok((await pl.eval(`${S}.tokens.find(t => t.name === "Ayla").sheet.slots[0][1]`)) === 1, "casting a spell uses a slot");
  await pl.eval(`document.querySelector("#modalClose").click()`);

  // Token yapici: kod ile uretilen bir resmi surukle-birak, kaydet, haritaya ekle
  await pl.click$(`document.querySelector('.tab[data-tab="tokens"]')`);
  await pl.click$(btn("Kendi resminden token yap"));
  await sleep(300);
  await pl.eval(`(async () => {
    const c = document.createElement("canvas"); c.width = 300; c.height = 200;
    const x = c.getContext("2d"); x.fillStyle = "#3a6"; x.fillRect(0, 0, 300, 200);
    x.fillStyle = "#fd5"; x.beginPath(); x.arc(150, 100, 60, 0, 7); x.fill();
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const dt = new DataTransfer(); dt.items.add(new File([blob], "orman-ruhu.png", { type: "image/png" }));
    document.querySelector(".tm-stage").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true }));
  })()`);
  await sleep(600);
  await pl.shot("11-token-yapici.png");
  await pl.click$(btn("Kaydet ve kullan"));
  await sleep(900);
  ok(await pl.eval(`document.querySelector("#modalTitle").textContent.includes("ekle")`), "token maker opens add-token with new image");
  await pl.click$(btn("Haritaya ekle"));
  await sleep(700);
  const made = await pl.eval(`${S}.tokens.filter(t => t.img && t.img.startsWith("/uploads/tokens/")).length`);
  ok(made >= 1, "token made with token maker placed on map");

  // Ses menusu
  await pl.click$(`document.querySelector("#soundMenuBtn")`);
  ok(await pl.eval(`!document.querySelector("#soundPop").hidden && document.querySelectorAll(".snd-row").length === 3`), "sound menu with 3 sliders");
  await pl.eval(`(() => { const r = document.querySelectorAll(".snd-range")[1]; r.value = 0.2; r.dispatchEvent(new Event("input")); })()`);
  ok(await pl.eval(`JSON.parse(localStorage.getItem("sanalmasa.sesayar")).fx === 0.2`), "effects volume saved");

  // Muzik
  await dm.click$(`document.querySelector('.tab[data-tab="dm"]')`);
  await dm.click$(btn("Yağmur"));
  await sleep(500);
  ok(await pl.eval(`document.querySelector("#soundMenuBtn").textContent.includes("Yağmur")`), "now-playing shown on player's sound button");
  await pl.shot("08b-ses-menusu.png");
  await dm.shot("08-dm-sekmesi.png");
  await dm.click$(btn("■ Durdur"));

  // Oturum ozeti ve yedek
  await dm.click$(btn("Oturum özetini gör"));
  await sleep(400);
  ok(await dm.eval(`document.querySelector("#modalTitle").textContent === "Oturum özeti"`), "session summary modal");
  await dm.shot("09-oturum-ozeti.png");
  await dm.eval(`document.querySelector("#modalClose").click()`);
  await dm.click$(btn("Şimdi yedekle"));
  await sleep(500);
  ok((await dm.eval(`document.querySelectorAll(".backup-row").length`)) >= 1, "backup listed");

  // Sesli sohbet: sahte mikrofonla gercek WebRTC baglantisi
  await dm.click$(`document.querySelector("#voiceBtn")`);
  await pl.click$(`document.querySelector("#voiceBtn")`);
  let states = [];
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    states = await pl.eval(`sanalMasa.voice.peerStates`);
    if (states[0] === "connected") break;
  }
  ok(states[0] === "connected", "voice chat peers connected (" + states.join(",") + ")");
  ok(await dm.eval(`document.querySelectorAll(".pdot.in-voice").length`) === 2, "both shown as in voice");
  await pl.shot("10-sesli-sohbet.png");

  await dm.eval(`sanalMasa.send({ t: "scene.delete", id: ${S}.id })`);
  console.log("\n  Konsol hatalari:", consoleErrors.length ? consoleErrors : "yok");
  if (consoleErrors.length) fails++;
} catch (err) {
  console.error("TEST HATASI:", err);
  fails++;
} finally {
  ws.close();
  proc.kill();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
}
