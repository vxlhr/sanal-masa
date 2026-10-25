// Ust cubuktaki ses menusu: calan muzik ve uc ayri ses duzeyi (muzik, efektler, sesli sohbet).
import { h, $, icon, fill } from "./util.js";
import { soundSettings } from "./sound.js";
import { AMBIENT } from "./music.js";

const ROWS = [
  { kind: "music", label: "Müzik ve ortam sesi", emoji: "🎵" },
  { kind: "fx", label: "Zar ve efektler", emoji: "🎲" },
  { kind: "voice", label: "Sesli sohbet", emoji: "🎙️" },
];

export function createSoundMenu(app) {
  const btn = $("#soundMenuBtn");
  const label = $("#soundMenuLabel");
  const pop = $("#soundPop");
  let music = null;

  function musicLabel(m) {
    if (!m) return null;
    if (m.kind === "ambient") {
      const a = AMBIENT.find((x) => x.key === m.track);
      return a ? `${a.emoji} ${a.name}` : "Ortam sesi";
    }
    return `🎵 ${m.name || "Müzik"}`;
  }

  function renderButton() {
    const allMuted = ROWS.every((r) => soundSettings.level(r.kind) === 0);
    btn.querySelector("use").setAttribute("href", allMuted ? "#i-speaker-off" : "#i-speaker");
    label.textContent = musicLabel(music) || "";
    btn.classList.toggle("playing", !!music);
  }

  function row(r) {
    const muted = soundSettings.muted(r.kind);
    const value = soundSettings.value(r.kind);
    const pct = h("span.snd-pct", Math.round((muted ? 0 : value) * 100) + "%");
    const range = h("input.snd-range", {
      type: "range", min: 0, max: 1, step: 0.05, value: muted ? 0 : value,
      style: { "--fill": (muted ? 0 : value) * 100 + "%" },
      onInput: (e) => {
        const v = Number(e.target.value);
        e.target.style.setProperty("--fill", v * 100 + "%");
        pct.textContent = Math.round(v * 100) + "%";
        soundSettings.set(r.kind, v);
        renderButton();
      },
    });
    return h("div.snd-row",
      h("button.snd-mute", {
        type: "button", class: muted || value === 0 ? "off" : "",
        title: muted ? "Sesi aç" : "Sessize al",
        onClick: () => { soundSettings.toggle(r.kind); renderPop(); renderButton(); },
      }, icon(muted || value === 0 ? "speaker-off" : "speaker")),
      h("div.snd-main", h("div.snd-label", `${r.emoji} ${r.label}`), range),
      pct);
  }

  function renderPop() {
    const isDm = app.state && app.state.you.isDm;
    const now = musicLabel(music);
    fill(pop,
      h("div.snd-now",
        h("div.snd-now-text",
          h("small", now ? "Şu an çalıyor" : "Müzik"),
          h("b", now || "Çalan bir şey yok")),
        isDm && music ? h("button.btn.small.danger", { type: "button", onClick: () => app.send({ t: "music.stop" }) }, "■ Durdur") : null,
        isDm ? h("button.btn.small", { type: "button", onClick: () => { pop.hidden = true; app.openTab("dm"); } }, music ? "Değiştir" : "Müzik seç") : null),
      ...ROWS.map(row),
      h("p.snd-note", "Ayarlar sadece senin için geçerlidir."));
  }

  btn.addEventListener("click", () => {
    pop.hidden = !pop.hidden;
    if (!pop.hidden) renderPop();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) pop.hidden = true;
  });

  app.onMusicChange = (m) => {
    music = m;
    renderButton();
    if (!pop.hidden) renderPop();
  };
  renderButton();

  return {};
}
