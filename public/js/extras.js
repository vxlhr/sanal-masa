// Masa eglenceleri: emoji tepkileri, oyunculara gorsel gosterme, "sira sende" uyarisi,
// davet linki ve yardim penceresi.
import { h, $, toast } from "./util.js";
import { openModal, closeModal, imageGrid } from "./picker.js";
import { playSound, fxLayer } from "./fx.js";
import { REACTIONS } from "./data.js";

export function createExtras(app) {
  /* ---------------- Emoji tepkileri ---------------- */
  const bar = $("#reactBar");
  bar.replaceChildren(...REACTIONS.map((e) => h("button", {
    type: "button", title: "Herkese gönder",
    onClick: () => app.send({ t: "react", emoji: e }),
  }, e)));

  function showReaction(m) {
    const el = h("div.react-float", { style: { left: 20 + Math.random() * 60 + "%" } },
      h("div.react-emoji", m.emoji),
      h("div.react-name", { style: { color: m.color } }, m.name));
    fxLayer().append(el);
    playSound("pop");
    setTimeout(() => el.remove(), 2600);
  }

  /* ---------------- Oyunculara gorsel ---------------- */
  let dismissed = null;
  const overlay = $("#handout");
  const reopen = $("#handoutBtn");

  function renderHandout(st) {
    const ho = st.handout;
    reopen.hidden = !ho || dismissed !== ho.id;
    if (!ho || dismissed === ho.id) { overlay.hidden = true; overlay._id = null; return; }
    if (overlay._id === ho.id) return;
    overlay._id = ho.id;
    overlay.hidden = false;
    overlay.replaceChildren(h("div.handout-box",
      ho.title ? h("h2", ho.title) : null,
      h("img", { src: ho.img, alt: ho.title || "Gösterilen görsel" }),
      h("div.handout-actions",
        st.you.isDm ? h("button.btn.danger", { type: "button", onClick: () => app.send({ t: "handout.hide" }) }, "Herkesten kapat") : null,
        h("button.btn.primary", { type: "button", onClick: () => { dismissed = ho.id; renderHandout(app.state); } }, "Kapat"))));
    if (!st.you.isDm) playSound("reveal");
  }

  reopen.addEventListener("click", () => { dismissed = null; renderHandout(app.state); });

  function openHandoutPicker() {
    let chosen = null;
    const title = h("input.input", { maxLength: 80, placeholder: "örn. Kralın mektubu (isteğe bağlı)" });
    const grid = imageGrid({ kind: "maps", secret: app.secret, onPick: (u) => { chosen = u; } });
    openModal("Oyunculara görsel göster", h("div.stack",
      h("p.muted.small-text", { style: { margin: 0 } }, "Mektup, harita parçası, NPC portresi… Seçtiğin görsel herkesin ekranında büyük açılır."),
      h("label.field", h("span", "Başlık"), title),
      grid.el,
      h("div.form-foot",
        h("button.btn.ghost", { type: "button", onClick: closeModal }, "Vazgeç"),
        h("button.btn.primary", {
          type: "button",
          onClick: () => {
            if (!chosen) return toast("Bir görsel seç.", "error");
            app.send({ t: "handout.show", img: chosen, title: title.value.trim() });
            closeModal();
          },
        }, "Herkese göster"))));
  }

  /* ---------------- Sira sende ---------------- */
  let wasMyTurn = false;
  let titleTimer = null;
  const baseTitle = document.title;

  function checkTurn(st) {
    const s = st.scene;
    const c = s && s.combat;
    const cur = c && c.active ? s.tokens.find((t) => t.id === c.currentTokenId) : null;
    const mine = !!(cur && !st.you.isDm && cur.ownerId === st.you.id);
    if (mine && !wasMyTurn) {
      toast(`⚔ Sıra sende, ${cur.name}!`, "ok");
      playSound("turn");
      app.board.centerOn(cur);
      if (document.hidden) {
        let on = false;
        clearInterval(titleTimer);
        titleTimer = setInterval(() => { document.title = (on = !on) ? "⚔ SIRA SENDE!" : baseTitle; }, 900);
      }
    }
    wasMyTurn = mine;
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { clearInterval(titleTimer); document.title = baseTitle; }
  });

  /* ---------------- Davet ---------------- */
  $("#inviteBtn").addEventListener("click", async () => {
    let info = {};
    try { info = await (await fetch("/api/info")).json(); } catch { /* yok */ }
    const link = info.publicUrl ? info.publicUrl + "/" : location.origin + "/";
    const local = !info.publicUrl && /^(localhost|127\.|\[::1\]|192\.168\.|10\.)/.test(location.hostname);
    try { await navigator.clipboard.writeText(link); } catch { /* izin yoksa da goster */ }
    openModal("Arkadaşlarını davet et", h("div.stack",
      h("p", { style: { margin: 0 } }, "Bu linki gönder, tıklayan masaya gelir. Hiçbir şey kurmaları gerekmez:"),
      h("input.input.big", { value: link, readOnly: true, onFocus: (e) => e.target.select() }),
      local
        ? h("div.warn-box", "Dikkat: bu adres sadece bu bilgisayarda / bu evde çalışır. Başka evlerdeki arkadaşların için masayı ",
          h("b", "INTERNETE-AC"), " dosyasıyla başlat; buraya otomatik olarak herkese açık bir https adresi gelir.")
        : h("p.muted.small-text", { style: { margin: 0 } }, "Link panoya kopyalandı. WhatsApp ya da Discord'a yapıştırman yeterli."),
      h("div.form-foot", h("button.btn.primary", { type: "button", onClick: closeModal }, "Tamam"))));
  });

  /* ---------------- Yardim ---------------- */
  $("#helpBtn").addEventListener("click", () => {
    const row = (k, v) => h("tr", h("td", h("kbd", k)), h("td", v));
    openModal("Nasıl oynanır?", h("div.help",
      h("h3", "Harita"),
      h("table", h("tbody",
        row("Sürükle", "Boş yerde sürükle: haritayı kaydır. Kendi tokenini sürükle: taşı"),
        row("Tekerlek", "Yakınlaş / uzaklaş (telefonda iki parmak)"),
        row("V M D P T", "Seç · Ölç · Çiz · İşaret ver · Alan şablonu"),
        row("F W", "DM: Sis · Duvar/kapı/görüş"),
        row("Shift + sürükle", "Kutu içine alarak çoklu seçim (Shift + tık: ekle/çıkar)"),
        row("Ctrl + Z", "Geri al (taşıma, silme, çizim, hasar…)"),
        row("Ctrl + A", "Tüm tokenlarını seç"),
        row("Kapıya tıkla", "Aç / kapat (yanındaysan)"),
        row("Alt + tık", "Haritada bir yeri herkese göster"),
        row("Delete", "Seçili tokeni sil"),
        row("0", "Haritayı ekrana sığdır"))),
      h("h3", "Zar ve sohbet"),
      h("table", h("tbody",
        row("/r 1d20+5", "Zar at"),
        row("/r 2d20kh1", "Avantajlı at (kl1 = dezavantaj)"),
        row("/gr 1d20", "Gizli zar (sadece DM görür)"),
        row("/dm mesaj", "DM'e fısılda"),
        row("/deneme 20", "Zar efektlerini önizle (20 ya da 1)"))),
      h("h3", "Karakter"),
      h("p", "Karakter sekmesinden tokenini haritaya koy. Tokenine tıklayıp ", h("b", "Karakter kağıdı"),
        "nı aç: yetenek, beceri, saldırı ve büyülere tıklayınca zar otomatik atılır."),
      h("h3", "Sesli sohbet"),
      h("p", "Üstteki ", h("b", "Sesli sohbet"), " düğmesine bas ve mikrofon izni ver. Konuşan kişinin yuvarlağı yeşil yanar. Kişilerin sesini ayrı ayrı ayarlayabilirsin.")));
  });

  return {
    onState(st) {
      renderHandout(st);
      checkTurn(st);
    },
    showReaction,
    openHandoutPicker,
  };
}
