// Sohbet gunlugu ve zar tepsisi
import { h, $, $$, icon, timeStr } from "./util.js";
import { playRoll, preview, naturalD20 } from "./fx.js";

const DICE = [4, 6, 8, 10, 12, 20, 100];

export function createChat(app) {
  const log = $("#chatLog");
  const input = $("#chatInput");
  const badge = $("#chatBadge");
  let unread = 0;
  let count = 1;
  let mod = 0;
  let adv = "";
  const history = [];
  let histPos = -1;

  /* ---------------- Mesajlar ---------------- */

  function rollClass(roll) {
    const nat = naturalD20(roll);
    return nat === 20 ? "crit" : nat === 1 ? "fumble" : "";
  }

  function renderRoll(msg) {
    const r = msg.roll;
    const dice = [];
    r.parts.forEach((p, i) => {
      if (p.type === "mod") {
        dice.push(h("span.die-mod", (p.value < 0 ? "− " : "+ ") + Math.abs(p.value)));
        return;
      }
      if (i > 0) dice.push(h("span.die-mod", p.sign < 0 ? "−" : "+"));
      for (const roll of p.rolls) {
        const cls = roll.dropped ? "drop" : roll.v === p.sides ? "max" : roll.v === 1 ? "min" : "";
        dice.push(h("span.die", { class: cls, title: "d" + p.sides }, roll.v));
      }
    });
    const crit = rollClass(r);
    return [
      msg.label ? h("div.roll-label", msg.label) : null,
      h("div.roll-main",
        h("div.roll-total", { class: crit }, r.total),
        h("div.roll-detail",
          h("div.roll-expr", r.expr + ({ crit: " — Doğal 20!", fumble: " — Doğal 1" }[crit] || "")),
          h("div.roll-dice", dice))),
    ];
  }

  function renderMsg(msg, animate) {
    if (msg.type === "system") return h("div.msg.system", msg.text);
    const cls = [msg.whisper ? "whisper" : "", animate && msg.type === "roll" ? "roll-anim" : ""].filter(Boolean).join(" ");
    return h("div.msg", { class: cls },
      h("div.msg-head",
        h("span.msg-author", { style: { color: msg.color } }, msg.name + (msg.isDm ? " (DM)" : "")),
        msg.whisper ? h("span.whisper-tag", "gizli") : null,
        h("span.msg-time", timeStr(msg.ts))),
      msg.type === "roll" ? renderRoll(msg) : h("div.msg-text", msg.text));
  }

  function nearBottom() {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  }

  function setAll(list) {
    log.replaceChildren(...list.map((m) => renderMsg(m, false)));
    if (!list.length) log.append(h("div.msg.system", "Henüz mesaj yok. Selam ver ya da zar at!"));
    log.scrollTop = log.scrollHeight;
  }

  function add(msg) {
    const stick = nearBottom() || msg.fromId === app.state?.you.id;
    const empty = log.querySelector(".msg.system:only-child");
    if (empty) empty.remove();
    log.append(renderMsg(msg, true));
    if (msg.type === "roll") playRoll(msg);
    while (log.children.length > 300) log.firstChild.remove();
    if (stick) log.scrollTop = log.scrollHeight;
    if (!app.isTabOpen("chat") && msg.type !== "system") {
      unread++;
      badge.textContent = unread > 9 ? "9+" : unread;
      badge.hidden = false;
    }
  }

  function clearUnread() {
    unread = 0;
    badge.hidden = true;
  }

  /* ---------------- Zar tepsisi ---------------- */

  const row = $("#diceRow");
  for (const d of DICE) {
    row.append(h("button.die-btn", { type: "button", title: `d${d} at`, onClick: () => rollDie(d) },
      icon("d20"), "d" + (d === 100 ? "%" : d)));
  }

  function rollDie(sides) {
    let expr = `${count}d${sides}`;
    let label = "";
    if (sides === 20 && adv && count === 1) {
      expr = adv === "adv" ? "2d20kh1" : "2d20kl1";
      label = adv === "adv" ? "Avantajlı" : "Dezavantajlı";
    }
    if (mod) expr += (mod > 0 ? "+" : "") + mod;
    app.send({ t: "roll", expr, label, whisper: $("#diceSecret").checked });
  }

  function updateOpts() {
    $("#diceCount").textContent = count;
    $("#diceMod").textContent = (mod >= 0 ? "+" : "") + mod;
  }

  $("#diceCountUp").onclick = () => { count = Math.min(20, count + 1); updateOpts(); };
  $("#diceCountDown").onclick = () => { count = Math.max(1, count - 1); updateOpts(); };
  $("#diceModUp").onclick = () => { mod = Math.min(30, mod + 1); updateOpts(); };
  $("#diceModDown").onclick = () => { mod = Math.max(-30, mod - 1); updateOpts(); };
  for (const b of $$("#advSeg button")) {
    b.onclick = () => {
      adv = b.dataset.adv;
      $$("#advSeg button").forEach((x) => x.classList.toggle("on", x === b));
    };
  }

  /* ---------------- Yazma ---------------- */

  $("#chatForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    // /deneme 20 | 1 : efekti sadece kendi ekraninda gosterir
    const test = text.match(/^\/deneme\s*(20|1)?$/i);
    if (test) {
      preview(test[1] ?? 20);
      input.value = "";
      return;
    }
    app.send({ t: "chat.send", text, whisper: false });
    history.unshift(text);
    history.length = Math.min(history.length, 30);
    histPos = -1;
    input.value = "";
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && history.length) {
      histPos = Math.min(history.length - 1, histPos + 1);
      input.value = history[histPos];
      e.preventDefault();
    } else if (e.key === "ArrowDown" && histPos >= 0) {
      histPos--;
      input.value = histPos >= 0 ? history[histPos] : "";
      e.preventDefault();
    }
  });

  return { setAll, add, clearUnread };
}
