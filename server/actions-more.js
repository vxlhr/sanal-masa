// Ek komutlar: duvarlar ve gorus, alan sablonlari, notlar, saldiri/buyu, ortam muzigi,
// yedekler, oturum ozeti ve geri alma icin token geri yukleme.
import { newId, CONDITIONS, newSession } from "./state.js";
import { str, num, int, color, imageUrl, fail } from "./actions.js";

const AMBIENT = ["rain", "storm", "wind", "fire", "cave", "tavern", "forest"];
const SHAPES = ["circle", "cone", "line", "square"];

const audioUrl = (v) =>
  typeof v === "string" && /^\/uploads\/audio\/[\w\-.%]+$/i.test(v) && !v.includes("..") ? v : null;

export function createMoreActions(ctx) {
  const { store, scene, requireDm, findToken, requireControl, system, postRoll, cleanSheet } = ctx;

  return {
    /* ---------------- Duvarlar ve gorus ---------------- */
    "wall.add"(p, m) {
      requireDm(p);
      const s = scene();
      const segs = Array.isArray(m.segments) ? m.segments.slice(0, 200) : [];
      const ids = [];
      for (const seg of segs) {
        if (!Array.isArray(seg) || seg.length !== 4) continue;
        const c = seg.map((v) => Math.round(num(v, -1e5, 1e5, 0) * 10) / 10);
        if (Math.hypot(c[2] - c[0], c[3] - c[1]) < 2) continue;
        const w = { id: newId("w"), c, door: !!m.door, open: false };
        s.walls.push(w);
        ids.push(w.id);
      }
      if (s.walls.length > 3000) s.walls.splice(0, s.walls.length - 3000);
      ctx.reply({ t: "created", kind: "walls", ids, ref: m.ref });
      return "state";
    },

    "wall.delete"(p, m) {
      requireDm(p);
      const s = scene();
      const ids = new Set(Array.isArray(m.ids) ? m.ids : [m.id]);
      s.walls = s.walls.filter((w) => !ids.has(w.id));
      return "state";
    },

    "wall.clear"(p) {
      requireDm(p);
      scene().walls = [];
      return "state";
    },

    /** Kapi ac/kapat: DM her kapiyi, oyuncu sadece kendi tokenine yakin kapiyi acabilir */
    "door.toggle"(p, m) {
      const s = scene();
      const w = s.walls.find((x) => x.id === m.id && x.door);
      if (!w) fail("Kapı bulunamadı.");
      if (!p.isDm) {
        const reach = s.grid.size * 1.6;
        const mx = (w.c[0] + w.c[2]) / 2, my = (w.c[1] + w.c[3]) / 2;
        const near = s.tokens.some((t) => t.ownerId === p.id &&
          Math.hypot(t.x + (t.size * s.grid.size) / 2 - mx, t.y + (t.size * s.grid.size) / 2 - my) <= reach + (t.size * s.grid.size) / 2);
        if (!near) fail("Kapıyı açmak için yanına gitmelisin.");
      }
      w.open = !w.open;
      return "state";
    },

    "vision.set"(p, m) {
      requireDm(p);
      const v = scene().vision;
      if (m.enabled !== undefined) v.enabled = !!m.enabled;
      if (m.dark !== undefined) v.dark = !!m.dark;
      return "state";
    },

    /* ---------------- Alan sablonlari ---------------- */
    "template.add"(p, m) {
      const s = scene();
      const shape = SHAPES.includes(m.shape) ? m.shape : "circle";
      const t = {
        id: newId("tp"), ownerId: p.id, shape,
        x: num(m.x, -1e5, 1e5, 0), y: num(m.y, -1e5, 1e5, 0),
        angle: num(m.angle, -10, 10, 0),
        size: int(m.size, 5, 500, 20),
        color: color(m.color, p.color),
      };
      s.templates.push(t);
      if (s.templates.length > 100) s.templates.shift();
      ctx.reply({ t: "created", kind: "template", id: t.id, ref: m.ref });
      return "state";
    },

    "template.update"(p, m) {
      const s = scene();
      const t = s.templates.find((x) => x.id === m.id);
      if (!t) return "none";
      if (!p.isDm && t.ownerId !== p.id) fail("Başkasının şablonunu değiştiremezsin.");
      if (m.x !== undefined) t.x = num(m.x, -1e5, 1e5, t.x);
      if (m.y !== undefined) t.y = num(m.y, -1e5, 1e5, t.y);
      if (m.angle !== undefined) t.angle = num(m.angle, -10, 10, t.angle);
      if (m.size !== undefined) t.size = int(m.size, 5, 500, t.size);
      if (m.color !== undefined) t.color = color(m.color, t.color);
      return "state";
    },

    "template.delete"(p, m) {
      const s = scene();
      const t = s.templates.find((x) => x.id === m.id);
      if (!t) return "none";
      if (!p.isDm && t.ownerId !== p.id) fail("Başkasının şablonunu silemezsin.");
      s.templates = s.templates.filter((x) => x.id !== t.id);
      return "state";
    },

    "template.clear"(p) {
      const s = scene();
      s.templates = p.isDm ? [] : s.templates.filter((t) => t.ownerId !== p.id);
      return "state";
    },

    /* ---------------- Notlar ---------------- */
    "scene.notes"(p, m) {
      requireDm(p);
      scene().notes = typeof m.notes === "string" ? m.notes.slice(0, 20000) : "";
      return "state";
    },

    /* ---------------- Geri alma: silinen tokeni geri getir ---------------- */
    "token.restore"(p, m) {
      const s = scene();
      const t = m.token;
      if (!t || typeof t !== "object" || typeof t.id !== "string") fail("Geçersiz token.");
      if (s.tokens.some((x) => x.id === t.id)) return "none";
      if (!p.isDm && t.ownerId !== p.id) fail("Bu token senin değil.");
      const clean = {
        id: t.id.slice(0, 40),
        name: str(t.name, 40, "Token"),
        img: imageUrl(t.img),
        x: num(t.x, -1e5, 1e5, 0), y: num(t.y, -1e5, 1e5, 0),
        size: num(t.size, 0.5, 8, 1),
        color: color(t.color, p.color),
        kind: ["pc", "npc", "monster"].includes(t.kind) ? t.kind : "pc",
        ownerId: p.isDm ? (store.player(t.ownerId) ? t.ownerId : null) : p.id,
        hidden: p.isDm ? !!t.hidden : false,
        hp: int(t.hp, -99999, 99999, 0), maxHp: int(t.maxHp, 0, 99999, 0),
        ac: int(t.ac, 0, 99, 0), initMod: int(t.initMod, -20, 30, 0),
        conditions: Array.isArray(t.conditions) ? t.conditions.filter((c) => CONDITIONS.includes(c)) : [],
        notes: typeof t.notes === "string" ? t.notes.slice(0, 2000) : "",
        darkvision: int(t.darkvision, 0, 300, 0), light: int(t.light, 0, 300, 0),
      };
      if (t.sheet) clean.sheet = cleanSheet(t.sheet);
      s.tokens.push(clean);
      return "state";
    },

    /* ---------------- Saldiri ve buyu ---------------- */
    attack(p, m) {
      const s = scene();
      const t = findToken(s, m.id);
      requireControl(p, t);
      const sheet = t.sheet || {};
      const a = (sheet.attacks || [])[int(m.index, 0, 50, 0)];
      if (!a) fail("Saldırı bulunamadı.");
      const base = m.adv === "adv" ? "2d20kh1" : m.adv === "dis" ? "2d20kl1" : "1d20";
      const hit = postRoll(p, base + (a.bonus ? (a.bonus > 0 ? "+" : "") + a.bonus : ""), `${t.name} · ${a.name} (saldırı)`, false);
      const d20 = hit.parts.find((x) => x.type === "dice" && x.sides === 20);
      const nat = d20 ? d20.rolls.find((r) => !r.dropped).v : 0;
      if (nat === 1) return "none"; // dogal 1: hasar yok
      // Kritik vurusta hasar zarlari ikiye katlanir
      const dmg = nat === 20 ? a.damage.replace(/(\d*)d(\d+)/gi, (_, n, sd) => `${(Number(n) || 1) * 2}d${sd}`) : a.damage;
      try {
        postRoll(p, dmg, `${t.name} · ${a.name} hasarı${nat === 20 ? " (KRİTİK!)" : ""}`, false);
      } catch { /* hatali hasar ifadesi: saldiri yine de atildi */ }
      return "none";
    },

    "spell.cast"(p, m) {
      const s = scene();
      const t = findToken(s, m.id);
      requireControl(p, t);
      if (!t.sheet) fail("Önce karakter kağıdını doldur.");
      const level = int(m.level, 0, 9, 0);
      const name = str(m.name, 40, "Büyü");
      if (level > 0) {
        const slot = t.sheet.slots[level - 1];
        if (!slot || slot[1] >= slot[0]) fail(`${level}. seviye büyü yuvan kalmadı.`);
        slot[1]++;
      }
      system(`✨ ${t.name}: ${name}${level ? ` (${level}. seviye)` : " (hazır büyü)"}`);
      return "state";
    },

    "rest.long"(p, m) {
      const s = scene();
      const t = findToken(s, m.id);
      requireControl(p, t);
      if (t.maxHp) t.hp = t.maxHp;
      if (t.sheet) t.sheet.slots = t.sheet.slots.map(([max]) => [max, 0]);
      t.conditions = t.conditions.filter((c) => c === "Bitkin");
      system(`🌙 ${t.name} uzun dinlenme yaptı: can ve büyü yuvaları yenilendi.`);
      return "state";
    },

    /* ---------------- Ortam muzigi ---------------- */
    "music.play"(p, m) {
      requireDm(p);
      if (m.kind === "ambient") {
        if (!AMBIENT.includes(m.track)) fail("Bilinmeyen ortam sesi.");
        store.data.music = { kind: "ambient", track: m.track, startedAt: Date.now() };
      } else {
        const url = audioUrl(m.url);
        if (!url) fail("Bir ses dosyası seç.");
        store.data.music = { kind: "file", url, name: str(m.name, 80), startedAt: Date.now() };
      }
      return "state";
    },

    "music.stop"(p) {
      requireDm(p);
      store.data.music = null;
      return "state";
    },

    /* ---------------- Yedekler ---------------- */
    "backup.list"(p) {
      requireDm(p);
      ctx.reply({ t: "backups", list: ctx.backups.list().slice(0, 40) });
      return "none";
    },

    "backup.now"(p) {
      requireDm(p);
      store.saveNow();
      const name = ctx.backups.write(store.data, "elle");
      if (!name) fail("Yedek alınamadı.");
      ctx.reply({ t: "backups", list: ctx.backups.list().slice(0, 40), made: name });
      return "none";
    },

    "backup.restore"(p, m) {
      requireDm(p);
      let data;
      try { data = ctx.backups.read(String(m.name || "")); } catch (err) { fail("Yedek okunamadı: " + err.message); }
      ctx.replaceData(data, p);
      system(`DM masayı bir yedekten geri yükledi.`);
      return "none";
    },

    /* ---------------- Oturum ozeti ---------------- */
    "session.summary"(p, m) {
      requireDm(p);
      const ses = store.data.session;
      ctx.reply({ t: "session", session: ses, now: Date.now() });
      if (m.post) {
        const mins = Math.round((Date.now() - ses.startedAt) / 60000);
        const players = Object.values(ses.players).filter((x) => x.rolls > 0);
        const lucky = players.filter((x) => x.d20 >= 3).sort((a, b) => b.sum / b.d20 - a.sum / a.d20)[0];
        const lines = [
          `📜 OTURUM ÖZETİ — ${Math.floor(mins / 60)} sa ${mins % 60} dk`,
          `⚔ ${ses.combats} savaş, ${ses.rounds} tur · 💀 ${ses.kills.length} yaratık öldü`,
          `🩸 ${ses.damage} hasar verildi · 💚 ${ses.healing} iyileştirildi`,
          ...players.map((x) => `🎲 ${x.name}: ${x.rolls} atış, ${x.nat20}× doğal 20, ${x.nat1}× doğal 1`),
          lucky ? `🍀 Gecenin şanslısı: ${lucky.name} (d20 ort. ${(lucky.sum / lucky.d20).toFixed(1)})` : null,
        ].filter(Boolean);
        system(lines.join("\n"));
      }
      return "none";
    },

    "session.reset"(p) {
      requireDm(p);
      store.data.session = newSession();
      system("Yeni oturum başladı. İyi oyunlar!");
      return "state";
    },
  };
}
