// Pencere (modal) ve gorsel kutuphanesi secici
import { h, $, icon, toast } from "./util.js";

let onCloseFn = null;

export function openModal(title, content, onClose) {
  $("#modalTitle").textContent = title;
  $("#modalBody").replaceChildren(content);
  $("#modal").hidden = false;
  onCloseFn = onClose || null;
  const first = $("#modalBody").querySelector("input:not([type=file]), button");
  if (first && first.tagName === "INPUT") first.focus();
}

export function closeModal() {
  $("#modal").hidden = true;
  $("#modalBody").replaceChildren();
  const fn = onCloseFn;
  onCloseFn = null;
  if (fn) fn();
}

export function initModal() {
  $("#modalClose").addEventListener("click", closeModal);
  $("#modal").addEventListener("pointerdown", (e) => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });
}

export const isModalOpen = () => !$("#modal").hidden;

export async function fetchLibrary() {
  const res = await fetch("/api/library", { cache: "no-store" });
  return res.json();
}

export async function uploadImage(file, kind, secret) {
  if (file.size > 30 * 1024 * 1024) throw new Error("Dosya çok büyük (en fazla 30 MB).");
  const res = await fetch(`/api/upload?kind=${kind}&name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "X-Session": secret, "Content-Type": "application/octet-stream" },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Yükleme başarısız.");
  return data;
}

/**
 * Gorsel secim izgarasi. kind: "maps" | "tokens".
 * onPick(url|null) secimde cagrilir. Donen nesnenin .el ozelligi DOM'dur.
 */
export function imageGrid({ kind, secret, selected, allowNone, onPick, canUpload = true }) {
  const grid = h("div.pick-grid", { class: kind === "tokens" ? "tokens" : "" });
  let current = selected || null;

  const fileInput = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", multiple: true, hidden: true });
  fileInput.addEventListener("change", async () => {
    const files = [...fileInput.files];
    fileInput.value = "";
    let last = null;
    for (const f of files) {
      try {
        toast(`Yükleniyor: ${f.name}`);
        last = await uploadImage(f, kind, secret);
      } catch (err) {
        toast(err.message, "error");
      }
    }
    if (last) {
      toast("Görsel yüklendi", "ok");
      current = last.url;
      await load();
      onPick(current, last.name);
    }
  });

  function tile(item) {
    const el = h("button.pick", {
      type: "button",
      class: item.url === current ? "on" : "",
      title: item.name,
      onClick: () => {
        current = item.url;
        for (const p of grid.querySelectorAll(".pick")) p.classList.remove("on");
        el.classList.add("on");
        onPick(item.url, item.name);
      },
    },
    h("div.thumb", { style: { backgroundImage: `url("${item.url}")` } }),
    h("div.nm", item.name));
    return el;
  }

  async function load() {
    let lib;
    try { lib = await fetchLibrary(); } catch { grid.replaceChildren(h("p.muted", "Kütüphane yüklenemedi.")); return; }
    const items = lib[kind] || [];
    const tiles = [];
    if (canUpload) {
      tiles.push(h("button.pick.upload", { type: "button", onClick: () => fileInput.click() },
        icon("upload"), h("div", "Bilgisayardan yükle")));
    }
    if (allowNone) {
      const none = h("button.pick.none", {
        type: "button",
        class: current ? "" : "on",
        onClick: () => {
          current = null;
          for (const p of grid.querySelectorAll(".pick")) p.classList.remove("on");
          none.classList.add("on");
          onPick(null);
        },
      }, h("div.thumb", "Aa"), h("div.nm", "Görselsiz"));
      tiles.push(none);
    }
    tiles.push(...items.map(tile));
    grid.replaceChildren(...tiles);
  }

  load();
  return { el: h("div", grid, fileInput), reload: load };
}
