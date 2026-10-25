// Kucuk DOM ve genel yardimcilar

/** h("div.cls#id", {attrs}, ...children) */
export function h(spec, attrs, ...children) {
  const [, tag = "div", rest = ""] = spec.match(/^([a-z0-9]*)(.*)$/i);
  const el = document.createElement(tag || "div");
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === ".") el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs !== undefined && (attrs === null || typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "class") el.className += " " + v;
    else if (k in el && k !== "list" && k !== "form") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function icon(name, cls) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  if (cls) svg.setAttribute("class", cls);
  const use = document.createElementNS(ns, "use");
  use.setAttribute("href", "#i-" + name);
  svg.append(use);
  return svg;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(message, kind = "") {
  const box = $("#toasts");
  const t = h("div.toast", { class: kind }, message);
  box.append(t);
  setTimeout(() => { t.style.transition = "opacity .3s"; t.style.opacity = "0"; }, 3200);
  setTimeout(() => t.remove(), 3600);
}

export function throttle(fn, ms) {
  let last = 0, timer = null, lastArgs = null;
  const run = () => { last = Date.now(); timer = null; fn(...lastArgs); };
  const wrapped = (...args) => {
    lastArgs = args;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) run();
    else if (!timer) timer = setTimeout(run, wait);
  };
  wrapped.flush = () => { if (timer) { clearTimeout(timer); run(); } };
  wrapped.cancel = () => { clearTimeout(timer); timer = null; };
  return wrapped;
}

export function timeStr(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

export function initials(name) {
  return String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toLocaleUpperCase("tr");
}

/**
 * Odakli bir giris kutusu varken paneli yeniden cizmez (yazilan metin kaybolmasin),
 * odak ciktiginda bekleyen cizimi yapar. Ayni anahtarla tekrar cizmez.
 */
export function stableRender(container, key, build) {
  if (container._key === key) return;
  if (container.contains(document.activeElement) && document.activeElement.matches("input, textarea, select, [contenteditable]")) {
    container._pending = () => stableRender(container, key, build);
    if (!container._blurHooked) {
      container._blurHooked = true;
      container.addEventListener("focusout", () => setTimeout(() => {
        if (container.contains(document.activeElement)) return;
        const p = container._pending;
        container._pending = null;
        if (p) p();
      }, 0));
    }
    return;
  }
  container._key = key;
  container._pending = null;
  container.replaceChildren(...[].concat(build()).filter(Boolean));
}

export const KIND_LABEL = { pc: "Oyuncu karakteri", npc: "NPC", monster: "Düşman" };

export const PALETTE = ["#e05d5d", "#4f9be0", "#59b86b", "#d9a43c", "#a46be0", "#3cc6c0", "#e07d3c", "#d65fa8"];

/** "/assets/tokens/npc-mage-a1b2c3.webp" -> "Npc Mage" */
export function nameFromUrl(url) {
  return decodeURIComponent(String(url).split("/").pop())
    .replace(/\.\w+$/, "").replace(/-[0-9a-f]{6}$/, "").replace(/[-_]+/g, " ").trim()
    .replace(/(^|\s)\S/g, (c) => c.toLocaleUpperCase("tr"));
}
