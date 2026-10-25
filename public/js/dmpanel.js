// DM sekmesi: sahne notlari, ortam sesi/muzik, oturum ozeti, yedekler ve masa dosyasi.
import { h, $, stableRender, toast } from "./util.js";
import { openModal, closeModal, fetchLibrary, uploadImage } from "./picker.js";
import { AMBIENT } from "./music.js";

export function createDmPanel(app) {
  const el = $("#panel-dm");
  let backups = null;

  app.onBackups = (msg) => {
    backups = msg.list;
    if (msg.made) toast("Yedek alındı 💾", "ok");
    el._key = null;
    render(app.state);
  };

  app.onSession = (msg) => showSession(msg.session, msg.now);

  function render(st) {
    if (!st || !st.you.isDm) { el.replaceChildren(); el._key = null; return; }
    const s = st.scene;
    const key = JSON.stringify([s && s.id, s && s.notes, st.music, backups && backups.length, backups && backups[0] && backups[0].name]);
    stableRender(el, key, () => [
      // Notlar
      h("div.section-title", "Sahne notları", h("small.muted", "Sadece sen görürsün")),
      s ? h("textarea.input.dm-notes", {
        rows: 6, maxLength: 20000, value: s.notes || "",
        placeholder: "Bu sahnenin sırları, NPC replikleri, tuzaklar, ganimet…",
        onChange: (e) => app.send({ t: "scene.notes", notes: e.target.value }),
      }) : h("div.empty-note", "Aktif sahne yok."),

      // Muzik
      h("div.section-title", "Ortam sesi ve müzik", h("small.muted", "Herkeste çalar")),
      h("div.ambient-grid", AMBIENT.map((a) => h("button.ambient-btn", {
        type: "button",
        class: st.music && st.music.kind === "ambient" && st.music.track === a.key ? "on" : "",
        onClick: () => app.send({ t: "music.play", kind: "ambient", track: a.key }),
      }, h("span.amb-emoji", a.emoji), a.name))),
      h("div.row2", { style: { marginTop: "8px" } },
        h("button.btn.small", { type: "button", onClick: openMusicPicker }, "🎵 Kendi müziğin"),
        h("button.btn.small", { type: "button", disabled: !st.music, onClick: () => app.send({ t: "music.stop" }) }, "■ Durdur")),

      // Oturum
      h("div.section-title", "Oturum"),
      h("div.stack",
        h("button.btn.small.block.gold", { type: "button", onClick: () => app.send({ t: "session.summary" }) }, "📜 Oturum özetini gör"),
        h("button.btn.small.block", {
          type: "button",
          onClick: () => { if (confirm("Yeni oturum başlasın mı? Bu gecenin özeti sıfırlanır (masa ve karakterler aynen kalır).")) app.send({ t: "session.reset" }); },
        }, "Yeni oturum başlat")),

      // Yedekler
      h("div.section-title", "Yedekler", h("small.muted", "10 dakikada bir otomatik")),
      h("div.row2",
        h("button.btn.small", { type: "button", onClick: () => app.send({ t: "backup.now" }) }, "💾 Şimdi yedekle"),
        h("button.btn.small", { type: "button", onClick: () => app.send({ t: "backup.list" }) }, backups ? "Yenile" : "Yedekleri göster")),
      backups ? h("div.backup-list", backups.length ? backups.map((b) => h("div.backup-row",
        h("div", h("b", new Date(b.time).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })),
          h("small.muted", ` · ${b.kind} · ${Math.max(1, Math.round(b.size / 1024))} KB`)),
        h("button.btn.tiny", {
          type: "button",
          onClick: () => {
            if (confirm("Masa bu yedeğe geri dönsün mü? (Şu anki hali de önce yedeklenir.)")) app.send({ t: "backup.restore", name: b.name });
          },
        }, "Geri yükle"))) : h("p.muted.small-text", "Henüz yedek yok.")) : null,

      // Disa / ice aktarma
      h("div.section-title", "Masa dosyası", h("small.muted", "Başka bilgisayara taşı")),
      h("div.row2",
        h("button.btn.small", { type: "button", onClick: exportTable }, "⬇ Dışa aktar"),
        h("button.btn.small", { type: "button", onClick: importTable }, "⬆ İçe aktar")),
    ]);
  }

  /* ---------------- Muzik dosyasi ---------------- */

  async function openMusicPicker() {
    const list = h("div.stack");
    const fileInput = h("input", { type: "file", accept: "audio/*", hidden: true });

    async function load() {
      let lib;
      try { lib = await fetchLibrary(); } catch { return; }
      const items = lib.audio || [];
      list.replaceChildren(
        h("button.btn.small.block.gold", { type: "button", onClick: () => fileInput.click() }, "⬆ MP3 / OGG yükle"),
        ...(items.length ? items.map((a) => h("div.backup-row",
          h("span", a.name),
          h("button.btn.tiny.primary", {
            type: "button",
            onClick: () => { app.send({ t: "music.play", kind: "file", url: a.url, name: a.name }); closeModal(); },
          }, "▶ Çal"))) : [h("p.muted.small-text", "Henüz yüklenmiş müzik yok. Telif hakkı olmayan müzikler için: incompetech.com, tabletopaudio.com")]));
    }

    fileInput.addEventListener("change", async () => {
      const f = fileInput.files[0];
      fileInput.value = "";
      if (!f) return;
      try {
        toast(`Yükleniyor: ${f.name}`);
        await uploadImage(f, "audio", app.secret);
        toast("Müzik yüklendi", "ok");
        load();
      } catch (err) {
        toast(err.message, "error");
      }
    });

    openModal("Müzik çal", h("div", list, fileInput));
    load();
  }

  /* ---------------- Disa / ice aktarma ---------------- */

  async function exportTable() {
    try {
      const res = await fetch("/api/export", { headers: { "X-Session": app.secret } });
      if (!res.ok) throw new Error((await res.json()).error || "Dışa aktarılamadı.");
      const blob = await res.blob();
      const a = h("a", { href: URL.createObjectURL(blob), download: `sanal-masa-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast("Masa dosyası indirildi. Not: yüklediğin görseller dosyaya dahil değil.", "ok");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function importTable() {
    const input = h("input", { type: "file", accept: ".json,application/json" });
    input.addEventListener("change", async () => {
      const f = input.files[0];
      if (!f) return;
      if (!confirm(`"${f.name}" yüklensin mi? Şu anki masa önce yedeklenir, sonra değiştirilir.`)) return;
      try {
        const res = await fetch("/api/import", { method: "POST", headers: { "X-Session": app.secret, "Content-Type": "application/json" }, body: f });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "İçe aktarılamadı.");
        toast("Masa yüklendi", "ok");
      } catch (err) {
        toast(err.message, "error");
      }
    });
    input.click();
  }

  /* ---------------- Oturum ozeti ---------------- */

  function showSession(ses, now) {
    const mins = Math.max(0, Math.round((now - ses.startedAt) / 60000));
    const players = Object.values(ses.players).filter((p) => p.rolls > 0).sort((a, b) => b.rolls - a.rolls);
    const avg = (p) => (p.d20 ? (p.sum / p.d20).toFixed(1) : "–");
    const stat = (big, label) => h("div.sum-stat", h("b", big), h("span", label));
    openModal("Oturum özeti", h("div.session",
      h("div.sum-grid",
        stat(`${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`, "süre"),
        stat(ses.combats, "savaş"),
        stat(ses.rounds, "tur"),
        stat(ses.kills.length, "ölen yaratık"),
        stat(ses.damage, "hasar"),
        stat(ses.healing, "iyileştirme")),
      ses.kills.length ? h("p.small-text", "💀 ", ses.kills.join(", ")) : null,
      h("div.section-title", "Zarlar"),
      players.length ? h("table.sum-table",
        h("thead", h("tr", h("th", "Oyuncu"), h("th", "Atış"), h("th", "d20 ort."), h("th", "20"), h("th", "1"))),
        h("tbody", players.map((p) => h("tr", h("td", p.name), h("td", p.rolls), h("td", avg(p)), h("td.n20", p.nat20), h("td.n1", p.nat1)))))
        : h("p.muted", "Bu oturumda henüz zar atılmadı."),
      h("div.form-foot",
        h("button.btn.ghost", { type: "button", onClick: closeModal }, "Kapat"),
        h("button.btn.primary", { type: "button", onClick: () => { app.send({ t: "session.summary", post: true }); closeModal(); } }, "Sohbete paylaş"))));
  }

  return { render };
}
