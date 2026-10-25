// Yan panel sekmeleri: Savas, Tokenlar/Karakter, Haritalar (DM)
import { h, $, icon, stableRender, KIND_LABEL, toast, nameFromUrl } from "./util.js";
import { openModal, closeModal, imageGrid } from "./picker.js";
import { MONSTERS } from "./data.js";
import { openTokenMaker } from "./tokenmaker.js";

const SIZES = [
  { v: 0.5, label: "Minik" },
  { v: 1, label: "Orta" },
  { v: 2, label: "Büyük" },
  { v: 3, label: "Devasa" },
  { v: 4, label: "Dev" },
];

function hpText(t) {
  if (t.maxHp > 0) return `${t.hp}/${t.maxHp} HP`;
  if (t.hpState === "bloodied") return "Yaralı";
  if (t.hpState === "down") return "Yere düştü";
  return "";
}

function hpClass(t) {
  if (t.maxHp > 0) return t.hp <= 0 ? "down" : t.hp <= t.maxHp / 2 ? "bloodied" : "";
  return t.hpState || "";
}

/** Gorsel secilince isim kutusunu doldurur; kullanicinin yazdigi ismi ezmez. */
function autoName(input, url, label) {
  const current = input.value.trim();
  if (current && current !== input._auto) return;
  input.value = url ? label || nameFromUrl(url) : "";
  input._auto = input.value;
}

export function createPanels(app) {
  const combatEl = $("#panel-combat");
  const tokensEl = $("#panel-tokens");
  const scenesEl = $("#panel-scenes");

  /* ============================================================ */
  /* Savas                                                         */
  /* ============================================================ */

  function renderCombat(st) {
    const s = st.scene;
    const me = st.you;
    const key = JSON.stringify([s && s.id, s && s.combat, s && s.tokens.map((t) => [t.id, t.name, t.img, t.hp, t.maxHp, t.hpState, t.color, t.hidden, t.ownerId]), app.board.selectedId, me]);
    stableRender(combatEl, key, () => {
      if (!s) return h("div.empty-note", "Aktif sahne yok.");
      const c = s.combat;
      const byId = new Map(s.tokens.map((t) => [t.id, t]));
      const out = [];

      out.push(h("div.combat-head",
        c.active ? h("div.round", `Tur ${c.round}`) : h("div.section-title", { style: { margin: 0 } }, "İnisiyatif sırası"),
        c.active ? h("span.tag", { style: { background: "var(--red-soft)", color: "#f08c86" } }, "Savaşta") : null));

      if (!c.entries.length) {
        out.push(h("div.empty-note", me.isDm
          ? "Savaş listesi boş. Haritadaki tokenları aşağıdaki düğmeyle ekle."
          : "DM savaş başlattığında sıra burada görünecek."));
      } else {
        const list = h("div.init-list");
        c.entries.forEach((e) => {
          const t = byId.get(e.tokenId);
          if (!t) return;
          const mine = me.isDm || t.ownerId === me.id;
          const score = mine
            ? h("input.input.num", {
              type: "number", value: e.init ?? "", placeholder: "–", title: "İnisiyatif",
              onClick: (ev) => ev.stopPropagation(),
              onChange: (ev) => app.send({ t: "combat.setInit", id: t.id, init: ev.target.value === "" ? null : Number(ev.target.value) }),
            })
            : h("span.ro", e.init ?? "–");
          list.append(h("div.init-row", {
            class: [c.active && c.currentTokenId === t.id ? "current" : "", t.hidden ? "is-hidden" : ""].join(" "),
            onClick: () => { app.openCard(t.id); app.board.centerOn(t); },
          },
          h("div.init-score", score),
          h("div.init-pic", { style: { backgroundImage: t.img ? `url("${t.img}")` : "", borderColor: t.color } }),
          h("div.init-info",
            h("div.init-name", t.name + (t.hidden ? " (gizli)" : "")),
            h("div.init-hp", { class: hpClass(t) }, hpText(t))),
          mine && e.init == null
            ? h("button.btn.tiny.gold", { type: "button", title: "d20 + inisiyatif bonusu", onClick: (ev) => { ev.stopPropagation(); app.send({ t: "combat.roll", id: t.id }); } }, "Zar at")
            : null,
          me.isDm
            ? h("button.icon-btn.sm.danger", { type: "button", title: "Savaştan çıkar", onClick: (ev) => { ev.stopPropagation(); app.send({ t: "combat.remove", id: t.id }); } }, icon("x"))
            : null));
        });
        out.push(list);
      }

      if (me.isDm) {
        const notIn = s.tokens.filter((t) => !c.entries.some((e) => e.tokenId === t.id));
        const sel = app.board.selectedId && notIn.find((t) => t.id === app.board.selectedId);
        out.push(h("div.section-title", "Yönet"));
        out.push(h("div.stack",
          h("div.combat-actions",
            h("button.btn.small", { type: "button", disabled: !notIn.length, onClick: () => app.send({ t: "combat.add", ids: notIn.map((t) => t.id) }) }, "Haritadakileri ekle"),
            h("button.btn.small", { type: "button", disabled: !sel, title: "Haritada bir token seç", onClick: () => app.send({ t: "combat.add", ids: [sel.id] }) }, "Seçiliyi ekle")),
          h("button.btn.small.block", { type: "button", disabled: !c.entries.some((e) => e.init == null), onClick: () => app.send({ t: "combat.roll" }) },
            icon("d20", "ico"), "Eksik inisiyatifleri at"),
          c.active
            ? h("div.combat-actions",
              h("button.btn.small", { type: "button", onClick: () => app.send({ t: "combat.prev" }) }, "← Önceki"),
              h("button.btn.small.primary", { type: "button", onClick: () => app.send({ t: "combat.next" }) }, "Sonraki →"))
            : h("button.btn.primary.block", { type: "button", disabled: !c.entries.length, onClick: () => app.send({ t: "combat.start" }) }, "Savaşı başlat"),
          c.entries.length || c.active
            ? h("button.btn.small.danger.block", { type: "button", onClick: () => { if (confirm("Savaş bitirilsin ve liste temizlensin mi?")) app.send({ t: "combat.end" }); } }, "Savaşı bitir")
            : null));
      } else if (c.active) {
        const cur = byId.get(c.currentTokenId);
        if (cur && cur.ownerId === me.id) {
          out.push(h("button.btn.primary.block", { type: "button", style: { marginTop: "12px" }, onClick: () => app.send({ t: "combat.next" }) }, "Sıramı bitir"));
        }
      }
      return out;
    });
  }

  /* ============================================================ */
  /* Tokenlar / Karakter                                           */
  /* ============================================================ */

  function tokenRow(t, st) {
    const me = st.you;
    const owner = t.ownerId && st.players.find((p) => p.id === t.ownerId);
    return h("div.list-row", {
      class: [t.id === app.board.selectedId ? "selected" : "", t.hidden ? "is-hidden" : ""].join(" "),
      onClick: () => { app.openCard(t.id); app.board.centerOn(t); },
    },
    h("div.pic", { style: { backgroundImage: t.img ? `url("${t.img}")` : "", borderColor: t.color } }),
    h("div.nm", t.name, h("small", [KIND_LABEL[t.kind] || "", owner ? ` · ${owner.name}` : "", hpText(t) ? ` · ${hpText(t)}` : ""].join(""))),
    me.isDm
      ? h("button.icon-btn.sm", {
        type: "button", title: t.hidden ? "Oyunculara göster" : "Oyunculardan gizle",
        onClick: (e) => { e.stopPropagation(); app.send({ t: "token.update", id: t.id, fields: { hidden: !t.hidden } }); },
      }, icon(t.hidden ? "eye-off" : "eye"))
      : null);
  }

  function renderTokens(st) {
    const s = st.scene;
    const me = st.you;
    $("#tokensTabLabel").textContent = me.isDm ? "Tokenlar" : "Karakter";
    const key = JSON.stringify([s && s.id, s && s.tokens.map((t) => [t.id, t.name, t.img, t.hidden, t.color, t.ownerId, t.kind, t.hp, t.maxHp, t.hpState]), st.players, app.board.selectedId, me]);
    stableRender(tokensEl, key, () => {
      const out = [];
      if (!s) out.push(h("div.empty-note", "Aktif sahne yok."));
      else if (me.isDm) {
        out.push(h("div.row2",
          h("button.btn.primary", { type: "button", onClick: () => openAddToken(st) }, icon("plus", "ico"), "Token ekle"),
          h("button.btn.gold", { type: "button", onClick: () => openMaker(st) }, "🎨 Token yapıcı")));
        out.push(h("div.section-title", `Bu sahnedeki tokenlar (${s.tokens.length})`));
        out.push(s.tokens.length
          ? h("div.list", s.tokens.map((t) => tokenRow(t, st)))
          : h("div.empty-note", "Henüz token yok."));
      } else {
        const mine = s.tokens.filter((t) => t.ownerId === me.id);
        out.push(h("div.section-title", "Karakterim"));
        if (mine.length) out.push(h("div.list", mine.map((t) => tokenRow(t, st))));
        else out.push(h("div.empty-note", "Haritada henüz bir karakterin yok."));
        out.push(h("button.btn.primary.block", { type: "button", style: { marginTop: "10px" }, onClick: () => openAddToken(st) },
          icon("plus", "ico"), mine.length ? "Bir token daha ekle" : "Karakterimi haritaya koy"));
        out.push(h("button.btn.gold.block", { type: "button", style: { marginTop: "6px" }, onClick: () => openMaker(st) },
          "🎨 Kendi resminden token yap"));
        const others = s.tokens.filter((t) => t.ownerId !== me.id);
        if (others.length) {
          out.push(h("div.section-title", "Haritada görünenler"));
          out.push(h("div.list", others.map((t) => tokenRow(t, st))));
        }
      }

      out.push(...statsSection(st));

      out.push(h("div.section-title", "Masadakiler"));
      out.push(h("div.list", st.players.map((p) => h("div.list-row", { style: { cursor: "default" } },
        h("div.pic", { style: { background: p.color, borderColor: p.online ? "var(--green)" : "var(--line-2)" } }),
        h("div.nm", p.name + (p.id === me.id ? " (sen)" : ""), h("small", (p.isDm ? "Dungeon Master · " : "") + (p.online ? "Çevrimiçi" : "Çevrimdışı"))),
        me.isDm && !p.isDm
          ? h("button.btn.tiny.danger", { type: "button", onClick: () => { if (confirm(`${p.name} masadan çıkarılsın mı?`)) app.send({ t: "player.kick", id: p.id }); } }, "Çıkar")
          : null))));
      return out;
    });
  }

  function statsSection(st) {
    const rows = st.players.filter((p) => p.stats && p.stats.d20 > 0);
    if (!rows.length) return [];
    const avg = (p) => p.stats.sum / p.stats.d20;
    const ranked = rows.filter((p) => p.stats.d20 >= 5);
    const lucky = ranked.length > 1 ? ranked.reduce((a, b) => (avg(b) > avg(a) ? b : a)) : null;
    const cursed = ranked.length > 1 ? ranked.reduce((a, b) => (avg(b) < avg(a) ? b : a)) : null;
    const crit = rows.reduce((a, b) => (b.stats.nat20 > a.stats.nat20 ? b : a));

    const badge = (p) => [
      p === lucky ? h("span.tag.lucky", "🍀 En şanslı") : null,
      p === cursed ? h("span.tag.cursed", "💀 Lanetli") : null,
      p === crit && crit.stats.nat20 > 0 ? h("span.tag.crit", "⭐ 20 avcısı") : null,
    ];

    return [
      h("div.section-title", "Zar istatistikleri",
        st.you.isDm ? h("button.btn.tiny", { type: "button", onClick: () => { if (confirm("Herkesin zar istatistikleri sıfırlansın mı?")) app.send({ t: "stats.reset" }); } }, "Sıfırla") : null),
      h("div.stats-list", rows.slice().sort((a, b) => avg(b) - avg(a)).map((p) => h("div.stat-row",
        h("div.stat-who", h("i", { style: { background: p.color } }), p.name, badge(p)),
        h("div.stat-nums",
          h("span", { title: "d20 ortalaması" }, "ort. ", h("b", avg(p).toFixed(1))),
          h("span", { title: "Atılan d20 sayısı" }, h("b", p.stats.d20), " atış"),
          h("span.n20", { title: "Doğal 20" }, "20×", h("b", p.stats.nat20)),
          h("span.n1", { title: "Doğal 1" }, "1×", h("b", p.stats.nat1)))))),
    ];
  }

  /** Token yapicidan cikan resimle dogrudan token ekleme penceresini ac */
  function openMaker(st) {
    openTokenMaker({ secret: app.secret, name: st.you.isDm ? "" : st.you.name, onDone: (url, name) => openAddToken(app.state, { img: url, name }) });
  }

  function openAddToken(st, preset = {}) {
    const me = st.you;
    const form = { img: preset.img || null, name: preset.name || (me.isDm ? "" : me.name), kind: me.isDm ? "monster" : "pc", size: 1, maxHp: "", ac: "", initMod: "", hidden: false, ownerId: "" };

    const nameIn = h("input.input", { maxLength: 40, value: form.name, placeholder: me.isDm ? "örn. Goblin" : "Karakter adı" });
    const grid = imageGrid({
      kind: "tokens", secret: app.secret, allowNone: true, selected: form.img,
      onPick: (url, label) => {
        form.img = url;
        autoName(nameIn, url, label);
      },
    });

    const sizeSel = h("select.input", SIZES.map((sz) => h("option", { value: sz.v, selected: sz.v === 1 }, `${sz.label} (${sz.v}×${sz.v})`)));
    const hpIn = h("input.input", { type: "number", min: 0, placeholder: "örn. 12" });
    const acIn = h("input.input", { type: "number", min: 0, placeholder: "örn. 14" });
    const initIn = h("input.input", { type: "number", placeholder: "örn. 2" });

    const kindSel = h("select.input",
      h("option", { value: "monster" }, "Düşman"),
      h("option", { value: "npc" }, "NPC"),
      h("option", { value: "pc" }, "Oyuncu karakteri"));
    const ownerSel = h("select.input",
      h("option", { value: "" }, "Kimse (DM)"),
      st.players.filter((p) => !p.isDm).map((p) => h("option", { value: p.id }, p.name)));
    kindSel.onchange = () => { if (kindSel.value !== "pc") ownerSel.value = ""; };
    const hiddenIn = h("input", { type: "checkbox" });
    const presetSel = h("select.input", {
      onChange: () => {
        const mo = MONSTERS[Number(presetSel.value)];
        if (!mo) return;
        nameIn.value = mo.name;
        nameIn._auto = mo.name;
        hpIn.value = mo.hp;
        acIn.value = mo.ac;
        initIn.value = mo.init;
        sizeSel.value = String(mo.size);
        kindSel.value = "monster";
        ownerSel.value = "";
      },
    },
    h("option", { value: "" }, "— Listeden seç (HP, AC otomatik dolar) —"),
    MONSTERS.map((mo, i) => h("option", { value: i }, `${mo.name}  ·  ${mo.hp} HP · AC ${mo.ac} · ZD ${mo.cr}`)));
    const countIn = h("input.input", { type: "number", min: 1, max: 20, value: 1 });

    const submit = (e) => {
      e.preventDefault();
      const name = nameIn.value.trim();
      if (!name) { nameIn.focus(); return toast("Bir isim yaz.", "error"); }
      const c = app.board.viewCenter();
      const count = me.isDm ? Math.max(1, Math.min(20, Number(countIn.value) || 1)) : 1;
      const gs = st.scene.grid.size;
      for (let i = 0; i < count; i++) {
        app.send({
          t: "token.create",
          name: count > 1 ? `${name} ${i + 1}` : name,
          img: form.img,
          kind: me.isDm ? kindSel.value : "pc",
          ownerId: me.isDm ? ownerSel.value || null : undefined,
          hidden: me.isDm ? hiddenIn.checked : false,
          size: Number(sizeSel.value),
          maxHp: Number(hpIn.value) || 0,
          ac: Number(acIn.value) || 0,
          initMod: Number(initIn.value) || 0,
          x: c.x + (i % 5) * gs,
          y: c.y + Math.floor(i / 5) * gs,
        });
      }
      closeModal();
    };

    const body = h("form.stack", { onSubmit: submit },
      me.isDm ? h("label.field", h("span", "Hazır yaratık"), presetSel) : null,
      h("label.lbl", "Görsel"), grid.el,
      h("div.grid2",
        h("label.field", h("span", "İsim"), nameIn),
        h("label.field", h("span", "Boyut"), sizeSel)),
      h("div.grid3",
        h("label.field", h("span", "Maks. HP"), hpIn),
        h("label.field", h("span", "Zırh (AC)"), acIn),
        h("label.field", h("span", "İnisiyatif bonusu"), initIn)),
      me.isDm ? h("div.grid3",
        h("label.field", h("span", "Tür"), kindSel),
        h("label.field", h("span", "Sahibi (taşıyabilir)"), ownerSel),
        h("label.field", h("span", "Adet"), countIn)) : null,
      me.isDm ? h("label.switch", hiddenIn, h("span"), "Oyunculardan gizli ekle") : null,
      h("div.form-foot",
        h("button.btn.ghost", { type: "button", onClick: closeModal }, "Vazgeç"),
        h("button.btn.primary", { type: "submit" }, "Haritaya ekle")));

    openModal(me.isDm ? "Token ekle" : "Karakter ekle", body);
  }

  /* ============================================================ */
  /* Haritalar (DM)                                                */
  /* ============================================================ */

  function renderScenes(st) {
    if (!st.you.isDm) { scenesEl.replaceChildren(); scenesEl._key = null; return; }
    const s = st.scene;
    const key = JSON.stringify([st.scenes, st.activeSceneId, s && s.grid, s && s.name, s && s.map, !!st.handout]);
    stableRender(scenesEl, key, () => {
      const out = [];
      out.push(h("div.section-title", "Sahneler",
        h("button.btn.tiny.gold", { type: "button", onClick: openNewScene }, "+ Yeni sahne")));
      out.push(h("p.muted.small-text", { style: { margin: "0 0 10px" } }, "Bir sahneye tıklayınca herkes o haritaya geçer."));
      out.push(h("div.scene-grid", st.scenes.map((sc) => h("div.scene-card", {
        class: sc.id === st.activeSceneId ? "active" : "",
        style: { backgroundImage: sc.map ? `url("${sc.map}")` : "" },
        title: sc.name,
        onClick: () => { if (sc.id !== st.activeSceneId) app.send({ t: "scene.activate", id: sc.id }); },
      }, h("div.sc-label", h("span", sc.name), sc.id === st.activeSceneId ? h("i.live", "AKTİF") : null)))));

      if (!s) return out;
      const g = s.grid;
      const upd = (fields) => app.send({ t: "scene.update", id: s.id, ...fields });
      const updGrid = (gf) => upd({ grid: gf });

      const slider = (label, value, min, max, step, onInput) => {
        const num = h("input.input.num", { type: "number", value, min, max, step });
        const range = h("input", { type: "range", value, min, max, step });
        range.oninput = () => { num.value = range.value; onInput(Number(range.value)); };
        num.onchange = () => { range.value = num.value; onInput(Number(num.value)); };
        return h("label.field", h("span", label), h("div.range-row", range, num));
      };

      out.push(h("div.section-title", "Aktif sahne ayarları"));
      out.push(h("div.card.stack",
        h("label.field", h("span", "Sahne adı"),
          h("input.input", { value: s.name, maxLength: 60, onChange: (e) => upd({ name: e.target.value }) })),
        h("button.btn.small.block", { type: "button", onClick: () => openMapPicker(s) }, icon("map", "ico"), "Haritayı değiştir"),
        h("label.switch", h("input", { type: "checkbox", checked: g.show, onChange: (e) => updGrid({ show: e.target.checked }) }), h("span"), "Izgarayı göster"),
        slider("Kare boyutu (piksel)", g.size, 20, 250, 1, throttled((v) => updGrid({ size: v }))),
        slider("Yatay kaydırma", g.offsetX, 0, Math.round(g.size), 1, throttled((v) => updGrid({ offsetX: v }))),
        slider("Dikey kaydırma", g.offsetY, 0, Math.round(g.size), 1, throttled((v) => updGrid({ offsetY: v }))),
        slider("Izgara görünürlüğü", g.opacity, 0, 1, 0.05, throttled((v) => updGrid({ opacity: v }))),
        h("div.field", h("span", "Izgara rengi"),
          h("div.seg",
            h("button", { type: "button", class: g.color === "#000000" ? "on" : "", onClick: () => updGrid({ color: "#000000" }) }, "Siyah"),
            h("button", { type: "button", class: g.color === "#ffffff" ? "on" : "", onClick: () => updGrid({ color: "#ffffff" }) }, "Beyaz")))));
      out.push(h("p.muted.small-text", "İpucu: Kare boyutunu haritadaki karelere oturana kadar ayarla, sonra kaydırma ile hizala."));

      out.push(h("div.section-title", "Oyunculara göster"));
      out.push(h("div.stack",
        h("button.btn.small.block.gold", { type: "button", onClick: () => app.extras.openHandoutPicker() }, icon("scroll", "ico"), "Herkese bir görsel göster"),
        st.handout ? h("button.btn.small.block.danger", { type: "button", onClick: () => app.send({ t: "handout.hide" }) }, "Gösterimi herkesten kapat") : null));

      out.push(h("div.section-title", "Tehlikeli bölge"));
      out.push(h("div.stack",
        h("button.btn.small.block", { type: "button", onClick: () => { if (confirm("Sohbet geçmişi herkes için silinsin mi?")) app.send({ t: "chat.clear" }); } }, "Sohbeti temizle"),
        h("button.btn.small.danger.block", {
          type: "button",
          onClick: () => { if (confirm(`"${s.name}" sahnesi ve içindeki tüm tokenlar silinsin mi?`)) app.send({ t: "scene.delete", id: s.id }); },
        }, icon("trash", "ico"), "Bu sahneyi sil")));
      return out;
    });
  }

  function throttled(fn) {
    let timer = null, last = null;
    return (v) => {
      last = v;
      if (!timer) timer = setTimeout(() => { timer = null; fn(last); }, 120);
    };
  }

  function openMapPicker(s) {
    let chosen = s.map;
    const grid = imageGrid({ kind: "maps", secret: app.secret, selected: s.map, allowNone: true, onPick: (u) => { chosen = u; } });
    openModal("Harita seç", h("div",
      grid.el,
      h("div.form-foot",
        h("button.btn.ghost", { type: "button", onClick: closeModal }, "Vazgeç"),
        h("button.btn.primary", { type: "button", onClick: () => { app.send({ t: "scene.update", id: s.id, map: chosen }); closeModal(); } }, "Uygula"))));
  }

  function openNewScene() {
    let chosen = null;
    const nameIn = h("input.input", { maxLength: 60, placeholder: "örn. Terk Edilmiş Kule" });
    const grid = imageGrid({
      kind: "maps", secret: app.secret, allowNone: true,
      onPick: (u, label) => {
        chosen = u;
        autoName(nameIn, u, label);
      },
    });
    openModal("Yeni sahne", h("form.stack", {
      onSubmit: (e) => {
        e.preventDefault();
        app.send({ t: "scene.create", name: nameIn.value.trim() || "Yeni Sahne", map: chosen });
        closeModal();
      },
    },
    h("label.field", h("span", "Sahne adı"), nameIn),
    h("label.lbl", "Harita görseli"), grid.el,
    h("div.form-foot",
      h("button.btn.ghost", { type: "button", onClick: closeModal }, "Vazgeç"),
      h("button.btn.primary", { type: "submit" }, "Oluştur ve geç"))));
  }

  return {
    render(st) {
      renderCombat(st);
      renderTokens(st);
      renderScenes(st);
    },
    openAddToken: () => openAddToken(app.state),
    openNewScene,
  };
}
