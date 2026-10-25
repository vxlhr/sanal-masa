// Haritada secilen tokenin alt kisimda acilan karti
import { h, $, icon, stableRender, KIND_LABEL } from "./util.js";
import { openModal, closeModal, imageGrid } from "./picker.js";
import { openSheet } from "./sheet.js";

const CONDITIONS = [
  "Bilinçsiz", "Kör", "Sağır", "Korkmuş", "Tutulmuş", "Felçli", "Taşlaşmış",
  "Zehirli", "Yere Düşmüş", "Bağlı", "Sersemlemiş", "Görünmez", "Büyülenmiş",
  "Bitkin", "Konsantrasyon",
];

const SIZE_STEPS = [0.5, 1, 2, 3, 4, 5, 6];

export function createTokenCard(app) {
  const el = $("#tokenCard");
  let condsOpen = false;
  let lastId = null;

  function render(st) {
    const s = st.scene;
    const id = app.board.selectedId;
    if (id !== lastId) { lastId = id; condsOpen = false; }
    // Coklu secimde kart yerine alttaki toplu islem cubugu gosterilir
    const t = s && id && app.cardId === id && app.board.selectedIds.length < 2 && s.tokens.find((x) => x.id === id);
    if (!t) { el.hidden = true; el._key = null; el.replaceChildren(); return; }
    el.hidden = false;

    const me = st.you;
    const control = me.isDm || t.ownerId === me.id;
    const inCombat = s.combat.entries.some((e) => e.tokenId === t.id);
    const key = JSON.stringify([t, control, inCombat, st.players.length, condsOpen, s.vision]);

    stableRender(el, key, () => {
      const upd = (fields) => app.send({ t: "token.update", id: t.id, fields });
      const owner = t.ownerId && st.players.find((p) => p.id === t.ownerId);

      // Baslik
      const head = h("div.tc-head",
        h("div.tc-avatar", {
          style: { backgroundImage: t.img ? `url("${t.img}")` : "", borderColor: t.color, cursor: control ? "pointer" : "default" },
          title: control ? "Görseli değiştir" : "",
          onClick: () => control && changeImage(t),
        }),
        h("div.tc-name",
          h("input", { value: t.name, maxLength: 40, disabled: !control, onChange: (e) => upd({ name: e.target.value }), onKeydown: (e) => { if (e.key === "Enter") e.target.blur(); } }),
          h("div.tc-sub",
            h("span.tag", KIND_LABEL[t.kind] || ""),
            owner ? h("span", owner.name) : null,
            t.hidden ? h("span.tag.hidden-tag", "Oyunculardan gizli") : null)),
        h("button.icon-btn", { type: "button", title: "Kapat (Esc)", onClick: () => app.closeCard() }, icon("x")));

      // HP
      let hp;
      if (t.maxHp > 0 || control) {
        const f = t.maxHp > 0 ? Math.max(0, Math.min(1, t.hp / t.maxHp)) : 0;
        const amount = h("input.input.num", { type: "number", min: 0, placeholder: "0", title: "Miktar" });
        const apply = (sign) => {
          const v = Math.abs(Number(amount.value) || 0);
          if (!v) { amount.focus(); return; }
          const prevHp = t.hp;
          app.send({ t: "token.damage", id: t.id, amount: sign * v });
          app.recordUndo({ label: sign > 0 ? "Hasar" : "İyileştirme", undo: () => app.send({ t: "token.update", id: t.id, fields: { hp: prevHp } }) });
          amount.value = "";
        };
        amount.addEventListener("keydown", (e) => { if (e.key === "Enter") apply(1); });
        hp = h("div.hp-block",
          h("div.hp-line", h("span", "Can (HP)"),
            control
              ? h("span",
                h("b", { contentEditable: true, title: "Tıkla ve düzenle", onBlur: (e) => upd({ hp: Number(e.target.textContent) || 0 }), onKeydown: enterBlur }, t.hp),
                " / ",
                h("b", { contentEditable: true, title: "Maksimum HP", onBlur: (e) => upd({ maxHp: Number(e.target.textContent) || 0 }), onKeydown: enterBlur }, t.maxHp))
              : h("b", `${t.hp} / ${t.maxHp}`)),
          h("div.hp-bar", h("i", { class: f > 0.5 ? "" : f > 0.25 ? "mid" : "low", style: { width: f * 100 + "%" } })),
          control ? h("div.hp-ctrl",
            amount,
            h("button.btn.small.danger", { type: "button", onClick: () => apply(1) }, "Hasar"),
            h("button.btn.small", { type: "button", style: { color: "var(--green)" }, onClick: () => apply(-1) }, "İyileştir")) : null);
      } else {
        hp = h("div.hp-block", h("div.hp-line", h("span", "Durum"),
          h("b", t.hpState === "down" ? "Yere düştü" : t.hpState === "bloodied" ? "Yaralı" : "Sağlıklı görünüyor")));
      }

      const stat = (label, field, value, min, max) => h("div.stat", h("span", label),
        control
          ? h("input.input.num", { type: "number", value, min, max, onChange: (e) => upd({ [field]: Number(e.target.value) || 0 }) })
          : h("div.ro", value ?? "–"));

      const stats = t.ac === undefined ? null : h("div.stats",
        stat("Zırh (AC)", "ac", t.ac, 0, 99),
        t.initMod !== undefined ? stat("İnisiyatif", "initMod", t.initMod, -20, 30) : null);

      // Durumlar: varsayilan olarak sadece aktif olanlar, "+ Durum" ile tum liste
      const expanded = control && condsOpen;
      const conds = h("div.conds", { class: expanded ? "" : "readonly" },
        CONDITIONS.map((c) => h("button.cond", {
          type: "button",
          class: t.conditions.includes(c) ? "on" : "",
          title: control ? (t.conditions.includes(c) ? "Kaldır" : "Ekle") : "",
          onClick: () => {
            if (!control) return;
            const next = t.conditions.includes(c) ? t.conditions.filter((x) => x !== c) : [...t.conditions, c];
            upd({ conditions: next });
          },
        }, c)),
        control ? h("button.cond", {
          type: "button",
          style: { display: "inline-block", color: "var(--gold)", borderStyle: "dashed" },
          onClick: () => { condsOpen = !condsOpen; el._key = null; render(app.state); },
        }, expanded ? "Bitti" : "+ Durum") : null);
      const showConds = control || t.conditions.length;

      // Eylemler
      let actions = null;
      if (control) {
        const sizeIdx = SIZE_STEPS.indexOf(t.size);
        actions = h("div.tc-actions",
          h("div.stepper", { title: "Boyut" },
            h("button", { type: "button", onClick: () => upd({ size: SIZE_STEPS[Math.max(0, (sizeIdx < 0 ? 1 : sizeIdx) - 1)] }) }, "−"),
            h("span", { style: { minWidth: "54px", fontSize: "12px" } }, `${t.size}×${t.size}`),
            h("button", { type: "button", onClick: () => upd({ size: SIZE_STEPS[Math.min(SIZE_STEPS.length - 1, (sizeIdx < 0 ? 1 : sizeIdx) + 1)] }) }, "+")),
          me.isDm ? h("button.btn.small", { type: "button", onClick: () => upd({ hidden: !t.hidden }) },
            icon(t.hidden ? "eye" : "eye-off", "ico"), t.hidden ? "Göster" : "Gizle") : null,
          me.isDm ? h("button.btn.small", {
            type: "button",
            onClick: () => app.send(inCombat ? { t: "combat.remove", id: t.id } : { t: "combat.add", ids: [t.id] }),
          }, icon("sword", "ico"), inCombat ? "Savaştan çıkar" : "Savaşa ekle") : null,
          me.isDm ? ownerSelect(t, st, upd) : null,
          h("div.grow"),
          h("button.btn.small.danger", {
            type: "button", title: "Sil (Delete)",
            onClick: () => app.deleteTokens([t.id]),
          }, icon("trash", "ico"), "Sil"));
      }

      const sheetBtn = control
        ? h("button.btn.small.gold.block", { type: "button", style: { marginTop: "12px" }, onClick: () => openSheet(app, t) },
          icon("sheet", "ico"), "Karakter kağıdı · tıkla, zar at")
        : null;

      return [
        head,
        h("div.tc-body", hp, stats),
        sheetBtn,
        control ? sightBlock(t, upd, st) : null,
        showConds ? conds : null,
        control ? notesBlock(t, upd) : null,
        actions,
      ];
    });
  }

  /** Isik ve karanlik gorus (dinamik gorus acikken onemli) */
  function sightBlock(t, upd, st) {
    const vis = st.scene.vision;
    const field = (label, key, hint) => h("label.sight-field", { title: hint },
      h("span", label),
      h("select.input", { onChange: (e) => upd({ [key]: Number(e.target.value) }) },
        [0, 10, 20, 30, 40, 60, 90, 120].map((ft) => h("option", { value: ft, selected: (t[key] || 0) === ft }, ft ? `${ft} ft` : "Yok"))));
    return h("div.sight",
      field("💡 Işık", "light", "Token ışık yayar (meşale 20 ft, fener 30 ft…)"),
      field("👁 Karanlık görüş", "darkvision", "Karanlıkta bu mesafeye kadar görür (elf, cüce: 60 ft)"),
      vis && vis.enabled ? null : h("small.muted", "Görüş kapalı: DM duvar aracından açar."));
  }

  function notesBlock(t, upd) {
    return h("details.tc-notes", { open: !!t.notes },
      h("summary", app.state.you.isDm && t.kind !== "pc" ? "DM notları (oyuncular görmez)" : "Notlar"),
      h("textarea.input", {
        rows: 3, maxLength: 2000, value: t.notes || "", placeholder: "Taktik, eşyalar, hatırlatmalar…",
        onChange: (e) => upd({ notes: e.target.value }),
      }));
  }

  function enterBlur(e) {
    if (e.key === "Enter") { e.preventDefault(); e.target.blur(); }
  }

  function ownerSelect(t, st, upd) {
    return h("select.input", {
      style: { width: "auto", padding: "5px 8px", fontSize: "12px" },
      title: "Bu tokeni hangi oyuncu taşıyabilir?",
      onChange: (e) => upd({ ownerId: e.target.value || null }),
    },
    h("option", { value: "" }, "Sahibi: DM"),
    st.players.filter((p) => !p.isDm).map((p) => h("option", { value: p.id, selected: p.id === t.ownerId }, "Sahibi: " + p.name)));
  }

  function changeImage(t) {
    let chosen = t.img;
    const grid = imageGrid({ kind: "tokens", secret: app.secret, selected: t.img, allowNone: true, onPick: (u) => { chosen = u; } });
    openModal("Token görseli", h("div",
      grid.el,
      h("div.form-foot",
        h("button.btn.ghost", { type: "button", onClick: closeModal }, "Vazgeç"),
        h("button.btn.primary", { type: "button", onClick: () => { app.send({ t: "token.update", id: t.id, fields: { img: chosen } }); closeModal(); } }, "Uygula"))));
  }

  return { render };
}
