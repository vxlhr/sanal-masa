// Karakter kagidi: yetenek puanlari, kurtarma zarlari, beceriler. Her deger tiklanınca zar atar.
import { h, fill } from "./util.js";
import { openModal } from "./picker.js";
import { ABILITIES, SKILLS, mod, fmtMod, profForLevel, defaultSheet } from "./data.js";

export function openSheet(app, token) {
  const sheet = Object.assign(defaultSheet(), JSON.parse(JSON.stringify(token.sheet || {})));
  let adv = "";
  let saveTimer = null;

  sheet.attacks = sheet.attacks || [];
  sheet.spells = sheet.spells || [];
  sheet.slots = sheet.slots || Array.from({ length: 9 }, () => [0, 0]);

  const saveNow = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    sheet.prof = profForLevel(sheet.level);
    app.send({ t: "token.update", id: token.id, fields: { sheet } });
  };
  const save = () => {
    sheet.prof = profForLevel(sheet.level);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 350);
  };
  const flush = () => { if (saveTimer) saveNow(); };

  const roll = (bonus, label) => {
    const base = adv === "adv" ? "2d20kh1" : adv === "dis" ? "2d20kl1" : "1d20";
    const expr = base + (bonus ? (bonus > 0 ? "+" : "") + bonus : "");
    const advText = adv === "adv" ? " (avantajlı)" : adv === "dis" ? " (dezavantajlı)" : "";
    app.send({ t: "roll", expr, label: `${token.name} · ${label}${advText}` });
  };

  const body = h("div.sheet");

  function skillBonus(sk) {
    const base = mod(sheet[sk.ab]);
    if (sheet.expertise.includes(sk.key)) return base + sheet.prof * 2;
    if (sheet.skills.includes(sk.key)) return base + sheet.prof;
    return base;
  }

  function saveBonus(ab) {
    return mod(sheet[ab]) + (sheet.saves.includes(ab) ? sheet.prof : 0);
  }

  function numInput(value, min, max, onChange, cls = "") {
    return h("input.input.num", {
      class: cls, type: "number", value, min, max,
      onChange: (e) => {
        const v = Math.min(max, Math.max(min, Math.round(Number(e.target.value) || 0)));
        e.target.value = v;
        onChange(v);
        save();
        render();
      },
    });
  }

  function render() {
    sheet.prof = profForLevel(sheet.level);
    const perception = SKILLS.find((s) => s.key === "perception");

    const header = h("div.sheet-head",
      h("label.field", h("span", "Irk"), h("input.input", { value: sheet.race, maxLength: 40, placeholder: "örn. Elf", onChange: (e) => { sheet.race = e.target.value; save(); } })),
      h("label.field", h("span", "Sınıf"), h("input.input", { value: sheet.cls, maxLength: 40, placeholder: "örn. Büyücü", onChange: (e) => { sheet.cls = e.target.value; save(); } })),
      h("label.field", h("span", "Seviye"), numInput(sheet.level, 1, 20, (v) => { sheet.level = v; })),
      h("label.field", h("span", "Hız (ft)"), numInput(sheet.speed, 0, 200, (v) => { sheet.speed = v; })));

    const badges = h("div.sheet-badges",
      h("div.sheet-badge", h("span", "Yetkinlik"), h("b", fmtMod(sheet.prof))),
      h("button.sheet-badge.rollable", { type: "button", title: "İnisiyatif zarı at", onClick: () => roll(mod(sheet.dex), "İnisiyatif") },
        h("span", "İnisiyatif"), h("b", fmtMod(mod(sheet.dex)))),
      h("div.sheet-badge", h("span", "Pasif Algı"), h("b", 10 + skillBonus(perception))),
      h("div.seg.compact.sheet-adv",
        ...[["dis", "Dezavantaj"], ["", "Normal"], ["adv", "Avantaj"]].map(([k, label]) =>
          h("button", { type: "button", class: adv === k ? "on" : "", onClick: () => { adv = k; render(); } }, label))));

    const abilities = h("div.sheet-abilities", ABILITIES.map((a) => h("div.ab-card",
      h("div.ab-name", a.name),
      h("button.ab-mod", { type: "button", title: `${a.name} sınaması at`, onClick: () => roll(mod(sheet[a.key]), `${a.name} sınaması`) }, fmtMod(mod(sheet[a.key]))),
      numInput(sheet[a.key], 1, 30, (v) => { sheet[a.key] = v; }, "ab-score"),
      h("div.ab-save",
        h("label", { title: "Bu kurtarma zarında yetkin misin?" },
          h("input", {
            type: "checkbox", checked: sheet.saves.includes(a.key),
            onChange: (e) => {
              sheet.saves = e.target.checked ? [...sheet.saves, a.key] : sheet.saves.filter((x) => x !== a.key);
              save(); render();
            },
          }), "Kurtarma"),
        h("button.btn.tiny", { type: "button", onClick: () => roll(saveBonus(a.key), `${a.name} kurtarma zarı`) }, fmtMod(saveBonus(a.key)))))));

    const skills = h("div.sheet-skills", SKILLS.map((sk) => {
      const level = sheet.expertise.includes(sk.key) ? 2 : sheet.skills.includes(sk.key) ? 1 : 0;
      const short = ABILITIES.find((a) => a.key === sk.ab).short;
      return h("div.skill-row",
        h("button.prof-dot", {
          type: "button", class: ["", "on", "expert"][level],
          title: ["Yetkin değil (tıkla: yetkin)", "Yetkin (tıkla: uzman)", "Uzman (tıkla: kaldır)"][level],
          onClick: () => {
            sheet.skills = sheet.skills.filter((x) => x !== sk.key);
            sheet.expertise = sheet.expertise.filter((x) => x !== sk.key);
            if (level === 0) sheet.skills.push(sk.key);
            else if (level === 1) { sheet.skills.push(sk.key); sheet.expertise.push(sk.key); }
            save(); render();
          },
        }),
        h("button.skill-name", { type: "button", onClick: () => roll(skillBonus(sk), sk.name) },
          sk.name, h("small", short)),
        h("button.skill-bonus", { type: "button", onClick: () => roll(skillBonus(sk), sk.name) }, fmtMod(skillBonus(sk))));
    }));

    fill(body,
      header,
      badges,
      h("div.section-title", "Yetenekler", h("small.muted", "Büyük sayıya tıkla → zar at")),
      abilities,
      h("div.section-title", "Saldırılar", h("small.muted", "Saldır: isabet zarı + hasar, doğal 20'de hasar zarları ikiye katlanır")),
      attacksBlock(),
      h("div.section-title", "Büyü yuvaları", h("small.muted", "Kutulara tıkla: harcanan yuva")),
      slotsBlock(),
      h("div.section-title", "Büyüler"),
      spellsBlock(),
      h("button.btn.small.block", {
        type: "button", style: { marginTop: "12px" },
        onClick: () => {
          flush();
          sheet.slots = sheet.slots.map(([max]) => [max, 0]);
          app.send({ t: "rest.long", id: token.id });
          render();
        },
      }, "🌙 Uzun dinlenme (can ve büyü yuvaları dolar)"),
      h("div.section-title", "Beceriler", h("small.muted", "Nokta: yetkinlik (iki kez: uzmanlık)")),
      skills);
  }

  function attacksBlock() {
    const rows = sheet.attacks.map((a, i) => h("div.attack-row",
      h("input.input", { value: a.name, maxLength: 40, placeholder: "Uzun kılıç", onChange: (e) => { a.name = e.target.value; save(); } }),
      h("label.att-field", h("span", "İsabet"),
        h("input.input.num", { type: "number", value: a.bonus, min: -20, max: 30, onChange: (e) => { a.bonus = Math.round(Number(e.target.value) || 0); save(); } })),
      h("label.att-field", h("span", "Hasar"),
        h("input.input", { value: a.damage, maxLength: 40, placeholder: "1d8+3", onChange: (e) => { a.damage = e.target.value.trim() || "1d6"; save(); } })),
      h("button.btn.small.primary", {
        type: "button",
        onClick: () => { flush(); app.send({ t: "attack", id: token.id, index: i, adv }); },
      }, "⚔ Saldır"),
      h("button.icon-btn.sm.danger", { type: "button", title: "Sil", onClick: () => { sheet.attacks.splice(i, 1); save(); render(); } }, "✕")));
    return h("div.stack",
      rows.length ? rows : h("p.muted.small-text", { style: { margin: 0 } }, "Henüz saldırı yok."),
      h("button.btn.tiny.gold", {
        type: "button", style: { alignSelf: "flex-start" },
        onClick: () => {
          const bonus = Math.max(mod(sheet.str), mod(sheet.dex)) + sheet.prof;
          sheet.attacks.push({ name: "Yeni saldırı", bonus, damage: "1d6" + fmtMod(Math.max(mod(sheet.str), mod(sheet.dex))).replace("−", "-") });
          save(); render();
        },
      }, "+ Saldırı ekle"));
  }

  function slotsBlock() {
    return h("div.slots", sheet.slots.map((slot, i) => {
      const [max, used] = slot;
      return h("div.slot-col",
        h("div.slot-lvl", `${i + 1}.`),
        h("div.pips", Array.from({ length: max }, (_, k) => h("button.pip", {
          type: "button", class: k < used ? "used" : "",
          title: k < used ? "Harcandı (tıkla: geri ver)" : "Kullanılabilir (tıkla: harca)",
          onClick: () => { slot[1] = k < used ? k : k + 1; save(); render(); },
        }))),
        h("input.input.num.slot-max", {
          type: "number", min: 0, max: 9, value: max, title: `${i + 1}. seviye yuva sayısı`,
          onChange: (e) => { slot[0] = Math.max(0, Math.min(9, Math.round(Number(e.target.value) || 0))); slot[1] = Math.min(slot[1], slot[0]); save(); render(); },
        }));
    }));
  }

  function spellsBlock() {
    const sorted = sheet.spells.map((sp, i) => ({ sp, i })).sort((a, b) => a.sp.level - b.sp.level);
    const rows = sorted.map(({ sp, i }) => h("div.spell-row",
      h("select.input.spell-lvl", {
        onChange: (e) => { sp.level = Number(e.target.value); save(); render(); },
      }, Array.from({ length: 10 }, (_, l) => h("option", { value: l, selected: l === sp.level }, l === 0 ? "Hazır" : `${l}. sv`))),
      h("input.input", { value: sp.name, maxLength: 40, placeholder: "Büyü adı", onChange: (e) => { sp.name = e.target.value; save(); } }),
      h("button.btn.small.gold", {
        type: "button",
        onClick: () => {
          flush();
          if (sp.level > 0) {
            const slot = sheet.slots[sp.level - 1];
            if (slot[1] >= slot[0]) { app.send({ t: "spell.cast", id: token.id, level: sp.level, name: sp.name }); return; }
            slot[1]++;
          }
          app.send({ t: "spell.cast", id: token.id, level: sp.level, name: sp.name });
          render();
        },
      }, "✨ Kullan"),
      h("button.icon-btn.sm.danger", { type: "button", title: "Sil", onClick: () => { sheet.spells.splice(i, 1); save(); render(); } }, "✕")));
    return h("div.stack",
      rows.length ? rows : h("p.muted.small-text", { style: { margin: 0 } }, "Henüz büyü yok."),
      h("button.btn.tiny.gold", {
        type: "button", style: { alignSelf: "flex-start" },
        onClick: () => { sheet.spells.push({ name: "", level: 1 }); save(); render(); },
      }, "+ Büyü ekle"));
  }

  render();
  openModal(`${token.name} — Karakter Kağıdı`, body, flush);
}
