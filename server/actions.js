// Istemciden gelen tum komutlar. Her komut yetkiyi kontrol eder, durumu degistirir
// ve ne yayinlanacagini dondurur: "state" (herkese yeni goruntu), "none" ya da ozel islem.
import { rollExpression } from "./dice.js";
import { CONDITIONS, createScene, newId, canSee } from "./state.js";
import { createMoreActions } from "./actions-more.js";

export class ActionError extends Error {}

const lastReact = new Map(); // oyuncu -> son tepki zamani (spam onleme)
const REACTIONS = ["😂", "😱", "🔥", "👍", "💀", "🎲", "❤️", "🤔"];

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const SKILLS = [
  "acrobatics", "animal", "arcana", "athletics", "deception", "history", "insight", "intimidation",
  "investigation", "medicine", "nature", "perception", "performance", "persuasion", "religion",
  "sleight", "stealth", "survival",
];

/** Karakter kagidini dogrular; bilinmeyen alanlari atar. */
function cleanSheet(s) {
  const out = { prof: 2, saves: [], skills: [], expertise: [] };
  if (!s || typeof s !== "object") s = {};
  for (const a of ABILITIES) {
    const v = Math.round(Number(s[a]));
    out[a] = Number.isFinite(v) ? Math.min(30, Math.max(1, v)) : 10;
  }
  const prof = Math.round(Number(s.prof));
  out.prof = Number.isFinite(prof) ? Math.min(10, Math.max(0, prof)) : 2;
  if (Array.isArray(s.saves)) out.saves = s.saves.filter((x) => ABILITIES.includes(x));
  if (Array.isArray(s.skills)) out.skills = s.skills.filter((x) => SKILLS.includes(x));
  if (Array.isArray(s.expertise)) out.expertise = s.expertise.filter((x) => SKILLS.includes(x));
  for (const k of ["race", "cls"]) out[k] = typeof s[k] === "string" ? s[k].trim().slice(0, 40) : "";
  const lvl = Math.round(Number(s.level));
  out.level = Number.isFinite(lvl) ? Math.min(20, Math.max(1, lvl)) : 1;
  const speed = Math.round(Number(s.speed));
  out.speed = Number.isFinite(speed) ? Math.min(200, Math.max(0, speed)) : 30;

  // Saldirilar: { name, bonus, damage }
  out.attacks = (Array.isArray(s.attacks) ? s.attacks : []).slice(0, 20).map((a) => ({
    name: typeof a?.name === "string" ? a.name.trim().slice(0, 40) : "Saldırı",
    bonus: Math.max(-20, Math.min(30, Math.round(Number(a?.bonus) || 0))),
    damage: typeof a?.damage === "string" && /^[\dd+\-\s%kKhHlL]{1,40}$/.test(a.damage) ? a.damage.trim() : "1d6",
  }));
  // Buyu yuvalari: seviye 1-9 icin [maks, kullanilan]
  out.slots = Array.from({ length: 9 }, (_, i) => {
    const v = Array.isArray(s.slots) && Array.isArray(s.slots[i]) ? s.slots[i] : [0, 0];
    const max = Math.max(0, Math.min(9, Math.round(Number(v[0]) || 0)));
    return [max, Math.max(0, Math.min(max, Math.round(Number(v[1]) || 0)))];
  });
  // Buyuler: { name, level }
  out.spells = (Array.isArray(s.spells) ? s.spells : []).slice(0, 60).map((x) => ({
    name: typeof x?.name === "string" ? x.name.trim().slice(0, 40) : "Büyü",
    level: Math.max(0, Math.min(9, Math.round(Number(x?.level) || 0))),
  }));
  return out;
}


const fail = (msg) => { throw new ActionError(msg); };

const str = (v, max, fallback = "") => {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s || fallback;
};

const num = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const int = (v, min, max, fallback) => Math.round(num(v, min, max, fallback));

const color = (v, fallback) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);

const imageUrl = (v) =>
  typeof v === "string" && /^\/(assets|uploads)\/[\w\-./%]+$/i.test(v) && !v.includes("..") ? v : null;

export { str, num, int, color, imageUrl, fail };

export function createActions(ctx) {
  const { store } = ctx;

  const scene = () => store.activeScene || fail("Aktif sahne yok.");
  const requireDm = (p) => { if (!p.isDm) fail("Bunu sadece DM yapabilir."); };
  const findToken = (s, id) => s.tokens.find((t) => t.id === id) || fail("Token bulunamadı.");
  const canControl = (p, t) => p.isDm || (t.ownerId && t.ownerId === p.id);
  const requireControl = (p, t) => { if (!canControl(p, t)) fail("Bu token senin değil."); };

  const snap = (s, v, offset) => {
    const g = s.grid.size;
    return Math.round((v - offset) / g) * g + offset;
  };

  function system(text) {
    ctx.pushChat({ id: newId("m"), ts: Date.now(), type: "system", text });
  }

  /** Oyuncunun d20 istatistikleri: atis sayisi, toplam, dogal 20 ve 1'ler */
  function recordStats(p, result) {
    const st = p.stats || (p.stats = { d20: 0, sum: 0, nat20: 0, nat1: 0 });
    const ss = sessionStats(p);
    for (const part of result.parts) {
      if (part.type !== "dice" || part.sides !== 20) continue;
      for (const r of part.rolls) {
        if (r.dropped) continue;
        st.d20++;
        st.sum += r.v;
        if (r.v === 20) { st.nat20++; ss.nat20++; }
        if (r.v === 1) { st.nat1++; ss.nat1++; }
        ss.d20++;
        ss.sum += r.v;
      }
    }
    ctx.statsChanged();
  }

  /** Bu oturumdaki oyuncu istatistigi (oturum ozeti icin) */
  function sessionStats(p) {
    const ses = store.data.session;
    return ses.players[p.id] || (ses.players[p.id] = { name: p.name, d20: 0, sum: 0, nat20: 0, nat1: 0, rolls: 0 });
  }

  function postRoll(p, expr, label, whisper) {
    let result;
    try { result = rollExpression(expr); } catch (err) { fail(err.message); }
    recordStats(p, result);
    const ss = sessionStats(p);
    ss.rolls++;
    ss.name = p.name;
    ctx.pushChat({
      id: newId("m"), ts: Date.now(), type: "roll",
      fromId: p.id, name: p.name, color: p.color, isDm: p.isDm,
      label: str(label, 60), whisper: !!whisper, roll: result,
    });
    return result;
  }

  function sortCombat(s) {
    const c = s.combat;
    const current = c.entries[c.turn] ? c.entries[c.turn].tokenId : null;
    c.entries.sort((a, b) => (b.init ?? -99) - (a.init ?? -99));
    const idx = c.entries.findIndex((e) => e.tokenId === current);
    c.turn = idx >= 0 ? idx : 0;
  }

  function tokenName(s, id) {
    const t = s.tokens.find((x) => x.id === id);
    return t ? t.name : "?";
  }

  function announceTurn(s) {
    const c = s.combat;
    const e = c.entries[c.turn];
    if (!e) return;
    const t = s.tokens.find((x) => x.id === e.tokenId);
    if (t && !t.hidden) system(`Tur ${c.round}: sıra ${t.name}'da.`);
  }

  const core = {
    /* ---------------- Sahneler ---------------- */
    "scene.create"(p, m) {
      requireDm(p);
      const s = createScene(str(m.name, 60, "Yeni Sahne"), imageUrl(m.map));
      store.data.scenes.push(s);
      if (m.activate !== false) store.data.activeSceneId = s.id;
      return "state";
    },

    "scene.activate"(p, m) {
      requireDm(p);
      const s = store.scene(m.id) || fail("Sahne bulunamadı.");
      store.data.activeSceneId = s.id;
      system(`Sahne değişti: ${s.name}`);
      return "state";
    },

    "scene.update"(p, m) {
      requireDm(p);
      const s = store.scene(m.id) || fail("Sahne bulunamadı.");
      if (m.name !== undefined) s.name = str(m.name, 60, s.name);
      if (m.map !== undefined) s.map = imageUrl(m.map);
      if (m.grid) {
        const g = s.grid;
        g.size = num(m.grid.size ?? g.size, 10, 400, g.size);
        g.offsetX = num(m.grid.offsetX ?? g.offsetX, -400, 400, g.offsetX);
        g.offsetY = num(m.grid.offsetY ?? g.offsetY, -400, 400, g.offsetY);
        g.opacity = num(m.grid.opacity ?? g.opacity, 0, 1, g.opacity);
        g.color = color(m.grid.color, g.color);
        if (m.grid.show !== undefined) g.show = !!m.grid.show;
      }
      return "state";
    },

    "scene.delete"(p, m) {
      requireDm(p);
      const i = store.data.scenes.findIndex((s) => s.id === m.id);
      if (i < 0) fail("Sahne bulunamadı.");
      store.data.scenes.splice(i, 1);
      if (store.data.activeSceneId === m.id) {
        store.data.activeSceneId = store.data.scenes[0] ? store.data.scenes[0].id : null;
      }
      return "state";
    },

    /* ---------------- Tokenlar ---------------- */
    "token.create"(p, m) {
      const s = scene();
      const t = {
        id: newId("tk"),
        name: str(m.name, 40, p.isDm ? "Yaratık" : p.name),
        img: imageUrl(m.img),
        x: 0, y: 0,
        size: num(m.size, 0.5, 8, 1),
        color: color(m.color, p.color),
        kind: ["pc", "npc", "monster"].includes(m.kind) ? m.kind : "pc",
        ownerId: null,
        hidden: false,
        hp: 0, maxHp: 0, ac: 0, initMod: 0,
        conditions: [],
        notes: "",
      };
      t.maxHp = int(m.maxHp, 0, 99999, 0);
      t.hp = t.maxHp;
      t.ac = int(m.ac, 0, 99, 0);
      t.initMod = int(m.initMod, -20, 30, 0);
      if (p.isDm) {
        t.hidden = !!m.hidden;
        t.ownerId = store.player(m.ownerId) ? m.ownerId : null;
      } else {
        t.kind = "pc";
        t.ownerId = p.id;
        if (s.tokens.filter((x) => x.ownerId === p.id).length >= 6) fail("En fazla 6 token ekleyebilirsin.");
      }
      const half = (t.size * s.grid.size) / 2;
      t.x = snap(s, num(m.x, -1e5, 1e5, 0) - half, s.grid.offsetX);
      t.y = snap(s, num(m.y, -1e5, 1e5, 0) - half, s.grid.offsetY);
      s.tokens.push(t);
      ctx.reply({ t: "created", kind: "token", id: t.id, ref: m.ref });
      return "state";
    },

    "token.update"(p, m) {
      const s = scene();
      const t = findToken(s, m.id);
      requireControl(p, t);
      const f = m.fields || {};
      if (f.name !== undefined) t.name = str(f.name, 40, t.name);
      if (f.img !== undefined) t.img = imageUrl(f.img);
      if (f.size !== undefined) t.size = num(f.size, 0.5, 8, t.size);
      if (f.color !== undefined) t.color = color(f.color, t.color);
      if (f.maxHp !== undefined) t.maxHp = int(f.maxHp, 0, 99999, t.maxHp);
      if (f.hp !== undefined) t.hp = int(f.hp, -99999, 99999, t.hp);
      if (f.ac !== undefined) t.ac = int(f.ac, 0, 99, t.ac);
      if (f.initMod !== undefined) t.initMod = int(f.initMod, -20, 30, t.initMod);
      if (f.notes !== undefined) t.notes = typeof f.notes === "string" ? f.notes.slice(0, 2000) : t.notes;
      if (Array.isArray(f.conditions)) t.conditions = f.conditions.filter((c) => CONDITIONS.includes(c));
      if (f.darkvision !== undefined) t.darkvision = int(f.darkvision, 0, 300, 0);
      if (f.light !== undefined) t.light = int(f.light, 0, 300, 0);
      if (f.sheet !== undefined) {
        t.sheet = cleanSheet(f.sheet);
        // Inisiyatif bonusu = Ceviklik degistiricisi
        t.initMod = Math.floor((t.sheet.dex - 10) / 2);
      }
      if (p.isDm) {
        if (f.hidden !== undefined) t.hidden = !!f.hidden;
        if (f.kind !== undefined && ["pc", "npc", "monster"].includes(f.kind)) t.kind = f.kind;
        if (f.ownerId !== undefined) t.ownerId = store.player(f.ownerId) ? f.ownerId : null;
      }
      return "state";
    },

    "token.damage"(p, m) {
      const s = scene();
      const t = findToken(s, m.id);
      requireControl(p, t);
      const amount = int(m.amount, -99999, 99999, 0);
      const before = t.hp;
      t.hp = t.maxHp ? Math.min(t.maxHp, t.hp - amount) : t.hp - amount;
      const ses = store.data.session;
      if (amount > 0) ses.damage += Math.min(amount, Math.max(0, before));
      else ses.healing += Math.max(0, t.hp - before);
      if (before > 0 && t.hp <= 0 && t.maxHp > 0) {
        if (t.kind !== "pc") ses.kills.push(t.name);
        if (!t.hidden) system(t.kind === "pc" ? `🩸 ${t.name} yere düştü!` : `💀 ${t.name} öldü!`);
      }
      return "state";
    },

    "token.move"(p, m) {
      const s = scene();
      const t = findToken(s, m.id);
      requireControl(p, t);
      t.x = num(m.x, -1e5, 1e5, t.x);
      t.y = num(m.y, -1e5, 1e5, t.y);
      if (m.snap !== false && s.grid.size > 0) {
        t.x = snap(s, t.x, s.grid.offsetX);
        t.y = snap(s, t.y, s.grid.offsetY);
      }
      return "state";
    },

    /** Surukleme sirasinda anlik konum. Kaydedilmez, sadece gorebilenlere iletilir. */
    "token.drag"(p, m) {
      const s = scene();
      const t = findToken(s, m.id);
      requireControl(p, t);
      const x = num(m.x, -1e5, 1e5, t.x);
      const y = num(m.y, -1e5, 1e5, t.y);
      ctx.broadcastTo(
        (viewer) => viewer.id !== p.id && canSee(s, { ...t, x, y }, viewer),
        { t: "drag", id: t.id, x, y },
      );
      return "none";
    },

    "token.delete"(p, m) {
      const s = scene();
      const t = findToken(s, m.id);
      requireControl(p, t);
      s.tokens = s.tokens.filter((x) => x.id !== t.id);
      const c = s.combat;
      const idx = c.entries.findIndex((e) => e.tokenId === t.id);
      if (idx >= 0) {
        c.entries.splice(idx, 1);
        if (idx < c.turn) c.turn--;
        if (c.turn >= c.entries.length) c.turn = 0;
      }
      return "state";
    },

    /* ---------------- Sis ---------------- */
    "fog.toggle"(p, m) {
      requireDm(p);
      scene().fog.enabled = !!m.enabled;
      return "state";
    },

    "fog.op"(p, m) {
      requireDm(p);
      const s = scene();
      const op = {
        type: m.type === "hide" ? "hide" : "reveal",
        x: num(m.x, -1e5, 1e5, 0), y: num(m.y, -1e5, 1e5, 0),
        w: num(m.w, 1, 2e5, 1), h: num(m.h, 1, 2e5, 1),
      };
      s.fog.enabled = true;
      s.fog.ops.push(op);
      if (s.fog.ops.length > 500) s.fog.ops.shift();
      return "state";
    },

    "fog.undo"(p) {
      requireDm(p);
      scene().fog.ops.pop();
      return "state";
    },

    "fog.reset"(p, m) {
      requireDm(p);
      const s = scene();
      s.fog.ops = m.mode === "reveal" ? [{ type: "reveal", x: -1e5, y: -1e5, w: 2e5, h: 2e5 }] : [];
      s.fog.enabled = true;
      return "state";
    },

    /* ---------------- Cizim ---------------- */
    "draw.add"(p, m) {
      const s = scene();
      const pts = Array.isArray(m.points) ? m.points.slice(0, 4000).map((v) => num(v, -1e5, 1e5, 0)) : [];
      if (pts.length < 4) return "none";
      const d = {
        id: newId("dr"), ownerId: p.id,
        color: color(m.color, p.color), width: num(m.width, 1, 40, 4), points: pts,
      };
      s.drawings.push(d);
      ctx.reply({ t: "created", kind: "draw", id: d.id, ref: m.ref });
      if (s.drawings.length > 400) s.drawings.shift();
      return "state";
    },

    "draw.delete"(p, m) {
      const s = scene();
      const d = s.drawings.find((x) => x.id === m.id);
      if (!d) return "none";
      if (!p.isDm && d.ownerId !== p.id) fail("Başkasının çizimini silemezsin.");
      s.drawings = s.drawings.filter((x) => x.id !== d.id);
      return "state";
    },

    "draw.clear"(p, m) {
      const s = scene();
      s.drawings = p.isDm && m.all ? [] : s.drawings.filter((d) => d.ownerId !== p.id);
      return "state";
    },

    /* ---------------- Anlik isaretler ---------------- */
    ping(p, m) {
      ctx.broadcastTo(() => true, {
        t: "ping", x: num(m.x, -1e5, 1e5, 0), y: num(m.y, -1e5, 1e5, 0), color: p.color, name: p.name,
      });
      return "none";
    },

    react(p, m) {
      const now = Date.now();
      if (now - (lastReact.get(p.id) || 0) < 400) return "none";
      lastReact.set(p.id, now);
      if (!REACTIONS.includes(m.emoji)) return "none";
      ctx.broadcastTo(() => true, { t: "react", id: p.id, name: p.name, color: p.color, emoji: m.emoji });
      return "none";
    },

    /* ---------------- Oyunculara gorsel gosterme ---------------- */
    "handout.show"(p, m) {
      requireDm(p);
      const img = imageUrl(m.img);
      if (!img) fail("Bir görsel seç.");
      store.data.handout = { id: newId("ho"), img, title: str(m.title, 80) };
      return "state";
    },

    "handout.hide"(p) {
      requireDm(p);
      store.data.handout = null;
      return "state";
    },

    "stats.reset"(p) {
      requireDm(p);
      for (const x of store.data.players) delete x.stats;
      return "state";
    },

    measure(p, m) {
      const line = m.line && Array.isArray(m.line) && m.line.length === 4
        ? m.line.map((v) => num(v, -1e5, 1e5, 0)) : null;
      ctx.broadcastTo((v) => v.id !== p.id, { t: "measure", id: p.id, color: p.color, name: p.name, line });
      return "none";
    },

    /* ---------------- Sohbet & zar ---------------- */
    "chat.send"(p, m) {
      let text = str(m.text, 500);
      if (!text) return "none";
      let whisper = !!m.whisper;

      const cmd = text.match(/^\/(\w+)\s*(.*)$/s);
      if (cmd) {
        const [, name, rest] = cmd;
        const c = name.toLowerCase();
        if (c === "r" || c === "roll" || c === "zar") { postRoll(p, rest, "", whisper); return "none"; }
        if (c === "gr" || c === "gizlizar") { postRoll(p, rest, "", true); return "none"; }
        if (c === "w" || c === "dm" || c === "gizli" || c === "fisilda") { whisper = true; text = rest.trim(); }
        else fail(`Bilinmeyen komut: /${name}. Kullanılabilir: /r 1d20+3, /gr 1d20, /dm mesaj`);
        if (!text) return "none";
      }

      ctx.pushChat({
        id: newId("m"), ts: Date.now(), type: "text",
        fromId: p.id, name: p.name, color: p.color, isDm: p.isDm, text, whisper,
      });
      return "none";
    },

    roll(p, m) {
      postRoll(p, str(m.expr, 80), m.label, m.whisper);
      return "none";
    },

    "chat.clear"(p) {
      requireDm(p);
      store.data.chat = [];
      store.save();
      ctx.resendChat();
      return "none";
    },

    /* ---------------- Savas ---------------- */
    "combat.add"(p, m) {
      requireDm(p);
      const s = scene();
      const ids = Array.isArray(m.ids) ? m.ids : [];
      for (const id of ids) {
        if (s.tokens.some((t) => t.id === id) && !s.combat.entries.some((e) => e.tokenId === id)) {
          s.combat.entries.push({ tokenId: id, init: null });
        }
      }
      sortCombat(s);
      return "state";
    },

    "combat.remove"(p, m) {
      const s = scene();
      const t = s.tokens.find((x) => x.id === m.id);
      if (!p.isDm && !(t && t.ownerId === p.id)) fail("Bunu sadece DM yapabilir.");
      const c = s.combat;
      const idx = c.entries.findIndex((e) => e.tokenId === m.id);
      if (idx < 0) return "none";
      c.entries.splice(idx, 1);
      if (idx < c.turn) c.turn--;
      if (c.turn >= c.entries.length) c.turn = 0;
      return "state";
    },

    "combat.setInit"(p, m) {
      const s = scene();
      const t = findToken(s, m.id);
      requireControl(p, t);
      const e = s.combat.entries.find((x) => x.tokenId === t.id) || fail("Bu token savaşta değil.");
      e.init = m.init === null || m.init === "" ? null : int(m.init, -20, 99, 0);
      sortCombat(s);
      return "state";
    },

    "combat.roll"(p, m) {
      const s = scene();
      const c = s.combat;
      const targets = m.id
        ? c.entries.filter((e) => e.tokenId === m.id)
        : c.entries.filter((e) => e.init === null);
      if (!p.isDm) {
        if (!m.id) fail("Bunu sadece DM yapabilir.");
        requireControl(p, findToken(s, m.id));
      }
      for (const e of targets) {
        const t = s.tokens.find((x) => x.id === e.tokenId);
        if (!t) continue;
        const mod = t.initMod || 0;
        const expr = "1d20" + (mod ? (mod > 0 ? "+" : "") + mod : "");
        const res = postRoll(p, expr, `İnisiyatif: ${t.name}`, t.hidden || (p.isDm && t.kind !== "pc"));
        e.init = res.total;
      }
      sortCombat(s);
      return "state";
    },

    "combat.start"(p) {
      requireDm(p);
      const s = scene();
      const c = s.combat;
      if (!c.entries.length) fail("Önce savaşa token ekle.");
      c.active = true;
      c.round = 1;
      c.turn = 0;
      sortCombat(s);
      c.turn = 0;
      store.data.session.combats++;
      system("Savaş başladı!");
      announceTurn(s);
      return "state";
    },

    "combat.next"(p) {
      const s = scene();
      const c = s.combat;
      if (!c.active || !c.entries.length) fail("Savaş başlamadı.");
      const cur = c.entries[c.turn];
      const curTok = cur && s.tokens.find((t) => t.id === cur.tokenId);
      if (!p.isDm && !(curTok && curTok.ownerId === p.id)) fail("Sıra sende değil.");
      c.turn++;
      if (c.turn >= c.entries.length) { c.turn = 0; c.round++; store.data.session.rounds++; }
      announceTurn(s);
      return "state";
    },

    "combat.prev"(p) {
      requireDm(p);
      const c = scene().combat;
      if (!c.active || !c.entries.length) return "none";
      c.turn--;
      if (c.turn < 0) { c.turn = c.entries.length - 1; c.round = Math.max(1, c.round - 1); }
      return "state";
    },

    "combat.end"(p) {
      requireDm(p);
      const s = scene();
      s.combat = { active: false, round: 1, turn: 0, entries: [] };
      system("Savaş bitti.");
      return "state";
    },

    /* ---------------- Oyuncular ---------------- */
    "player.update"(p, m) {
      if (m.name !== undefined) {
        const name = str(m.name, 24, p.name);
        if (store.data.players.some((x) => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase())) {
          fail("Bu isim kullanılıyor.");
        }
        p.name = name;
      }
      if (m.color !== undefined) p.color = color(m.color, p.color);
      return "state";
    },

    "player.kick"(p, m) {
      requireDm(p);
      const target = store.player(m.id);
      if (!target || target.isDm) fail("Oyuncu bulunamadı.");
      store.data.players = store.data.players.filter((x) => x.id !== target.id);
      for (const s of store.data.scenes) {
        for (const t of s.tokens) if (t.ownerId === target.id) t.ownerId = null;
      }
      ctx.disconnectPlayer(target.id, "DM seni masadan çıkardı.");
      system(`${target.name} masadan çıkarıldı.`);
      return "state";
    },
  };

  const more = createMoreActions({
    ...ctx, scene, requireDm, findToken, requireControl, canControl, system, postRoll, snap, cleanSheet,
  });
  return { ...core, ...more };
}
