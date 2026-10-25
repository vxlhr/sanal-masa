// Oyun durumu: sahneler, tokenlar, oyuncular, sohbet. Diske kayit ve oyuncuya ozel goruntu.
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export const CONDITIONS = [
  "Bilinçsiz", "Kör", "Sağır", "Korkmuş", "Tutulmuş", "Felçli", "Taşlaşmış",
  "Zehirli", "Yere Düşmüş", "Bağlı", "Sersemlemiş", "Görünmez", "Büyülenmiş",
  "Bitkin", "Konsantrasyon",
];

const MAX_CHAT = 300;

export function newId(prefix) {
  return prefix + "_" + randomBytes(5).toString("hex");
}

export function newSecret() {
  return randomBytes(24).toString("hex");
}

export function createScene(name, map) {
  return {
    id: newId("sc"),
    name: name || "Yeni Sahne",
    map: map || null,
    grid: { size: 70, offsetX: 0, offsetY: 0, show: true, color: "#000000", opacity: 0.35 },
    fog: { enabled: false, ops: [] },
    tokens: [],
    drawings: [],
    walls: [],
    templates: [],
    vision: { enabled: false, dark: false },
    notes: "",
    combat: { active: false, round: 1, turn: 0, entries: [] },
  };
}

export function newSession() {
  return { startedAt: Date.now(), combats: 0, rounds: 0, kills: [], damage: 0, healing: 0, players: {} };
}

export class Store {
  constructor(file, seedMaps, onSaved) {
    this.file = file;
    this.onSaved = onSaved || null;
    this.saveTimer = null;
    this.data = this.load(seedMaps);
  }

  load(seedMaps) {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (raw && raw.formatVersion === 2) return normalize(raw);
    } catch (err) {
      if (err.code !== "ENOENT") console.warn("  [!] Kayit okunamadi, yeni masa aciliyor:", err.message);
    }
    const scenes = seedMaps.length ? seedMaps.map((m) => createScene(m.name, m.url)) : [createScene("İlk Sahne", null)];
    return {
      formatVersion: 2,
      activeSceneId: scenes[0] ? scenes[0].id : null,
      scenes,
      players: [],
      chat: [],
      session: newSession(),
    };
  }

  /** Degisikligi kisa bir gecikmeyle diske yazar (art arda gelen kayitlari birlestirir). */
  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 400);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
      if (this.onSaved) this.onSaved(this.data);
    } catch (err) {
      console.error("  [!] Kayit yazilamadi:", err.message);
    }
  }

  get activeScene() {
    return this.scene(this.data.activeSceneId);
  }

  scene(id) {
    return this.data.scenes.find((s) => s.id === id) || null;
  }

  player(id) {
    return this.data.players.find((p) => p.id === id) || null;
  }

  addChat(msg) {
    this.data.chat.push(msg);
    if (this.data.chat.length > MAX_CHAT) this.data.chat.splice(0, this.data.chat.length - MAX_CHAT);
    this.save();
  }
}

export function normalize(d) {
  d.scenes = Array.isArray(d.scenes) ? d.scenes : [];
  d.players = Array.isArray(d.players) ? d.players : [];
  d.chat = Array.isArray(d.chat) ? d.chat : [];
  for (const s of d.scenes) {
    const base = createScene(s.name, s.map);
    s.grid = Object.assign(base.grid, s.grid);
    s.fog = Object.assign(base.fog, s.fog);
    s.tokens = s.tokens || [];
    s.drawings = s.drawings || [];
    s.walls = s.walls || [];
    s.templates = s.templates || [];
    s.vision = Object.assign(base.vision, s.vision);
    s.notes = typeof s.notes === "string" ? s.notes : "";
    s.combat = Object.assign(base.combat, s.combat);
  }
  if (!d.session) d.session = newSession();
  if (!d.scenes.some((s) => s.id === d.activeSceneId)) d.activeSceneId = d.scenes[0] ? d.scenes[0].id : null;
  return d;
}

/* ------------------------------------------------------------------ */
/* Gorunurluk                                                          */
/* ------------------------------------------------------------------ */

/** Sis bu noktayi kapatiyor mu? Islemler sirayla uygulanir, en son kapsayan kazanir. */
export function isFogged(scene, x, y) {
  if (!scene.fog.enabled) return false;
  let covered = true;
  for (const op of scene.fog.ops) {
    if (x >= op.x && x <= op.x + op.w && y >= op.y && y <= op.y + op.h) covered = op.type === "hide";
  }
  return covered;
}

export function tokenCenter(scene, t) {
  const half = (t.size * scene.grid.size) / 2;
  return { x: t.x + half, y: t.y + half };
}

export const ftToPx = (scene, ft) => ((Number(ft) || 0) / 5) * scene.grid.size;

/** Iki dogru parcasi kesisiyor mu? (uc noktalara degme sayilmaz) */
function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(d) < 1e-9) return false;
  const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
  const v = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return u > 1e-6 && u < 1 - 1e-6 && v > 1e-6 && v < 1 - 1e-6;
}

/** Iki nokta arasinda duvar var mi? */
export function blocked(scene, x1, y1, x2, y2) {
  for (const w of scene.walls) {
    if (w.open) continue;
    const [a, b, c, d] = w.c;
    if (segmentsCross(x1, y1, x2, y2, a, b, c, d)) return true;
  }
  return false;
}

/** Nokta bir isik kaynagiyla aydinlaniyor mu? */
function isLit(scene, x, y) {
  for (const L of scene.tokens) {
    if (!(L.light > 0)) continue;
    const c = tokenCenter(scene, L);
    if (Math.hypot(c.x - x, c.y - y) <= ftToPx(scene, L.light) && !blocked(scene, c.x, c.y, x, y)) return true;
  }
  return false;
}

/** Dinamik gorus: oyuncunun tokenlarindan biri bu noktayi gorebiliyor mu? */
function playerSeesPoint(scene, player, x, y) {
  const lit = scene.vision.dark ? null : true;
  for (const v of scene.tokens) {
    if (v.ownerId !== player.id) continue;
    const c = tokenCenter(scene, v);
    if (blocked(scene, c.x, c.y, x, y)) continue;
    if (!scene.vision.dark) return true;
    if (Math.hypot(c.x - x, c.y - y) <= ftToPx(scene, v.darkvision)) return true;
    if (lit ?? isLit(scene, x, y)) return true;
  }
  return false;
}

/** Oyuncu bu tokeni gorebilir mi? */
export function canSee(scene, t, player) {
  if (player.isDm) return true;
  if (t.ownerId === player.id) return true;
  if (t.hidden) return false;
  const c = tokenCenter(scene, t);
  if (isFogged(scene, c.x, c.y)) return false;
  if (scene.vision.enabled && !playerSeesPoint(scene, player, c.x, c.y)) return false;
  return true;
}

function hpState(t) {
  if (!t.maxHp) return null;
  if (t.hp <= 0) return "down";
  if (t.hp <= t.maxHp / 2) return "bloodied";
  return "healthy";
}

function tokenView(t, player) {
  if (player.isDm || t.ownerId === player.id) return t;
  if (t.kind === "pc") {
    const { sheet, notes, ...pc } = t; // baskasinin karakter kagidi ozel
    return pc;
  }
  // Dusman/NPC: oyuncular tam HP, AC, not ve inisiyatif bonusunu gormez
  const { hp, maxHp, notes, initMod, ac, sheet, ...rest } = t;
  return { ...rest, hpState: hpState(t) };
}

export function sceneView(scene, player) {
  if (!scene) return null;
  const tokens = scene.tokens.filter((t) => canSee(scene, t, player)).map((t) => tokenView(t, player));
  const visible = new Set(tokens.map((t) => t.id));

  const c = scene.combat;
  let entries = c.entries;
  let currentTokenId = c.active && entries[c.turn] ? entries[c.turn].tokenId : null;
  if (!player.isDm) {
    entries = entries.filter((e) => visible.has(e.tokenId));
    if (!visible.has(currentTokenId)) currentTokenId = c.active ? "?" : null;
  }

  return {
    id: scene.id,
    name: scene.name,
    map: scene.map,
    grid: scene.grid,
    fog: scene.fog,
    tokens,
    drawings: scene.drawings,
    walls: scene.walls,
    templates: scene.templates,
    vision: scene.vision,
    // Isik kaynaklari (gizli tokenlarinki dahil, sadece konum ve yaricap)
    lights: scene.tokens.filter((t) => t.light > 0).map((t) => {
      const p = tokenCenter(scene, t);
      return { x: p.x, y: p.y, r: ftToPx(scene, t.light) };
    }),
    notes: player.isDm ? scene.notes : undefined,
    combat: { active: c.active, round: c.round, currentTokenId, entries },
  };
}

export function chatVisible(msg, player) {
  if (!msg.whisper) return true;
  return player.isDm || msg.fromId === player.id;
}
