// Token yapici: herhangi bir resimden yuvarlak, cerceveli token uretir ve kutuphaneye yukler.
// Resim: dosya secerek, surukle-birak ya da Ctrl+V ile yapistirarak.
import { h, toast, icon } from "./util.js";
import { uploadImage } from "./picker.js";

const SIZE = 512;
const RINGS = [
  { c: null, label: "Yok" },
  { c: "#d0a752", label: "Altın" },
  { c: "#c9ccd4", label: "Gümüş" },
  { c: "#9b5a2a", label: "Bronz" },
  { c: "#e05d5d", label: "Kırmızı" },
  { c: "#4f9be0", label: "Mavi" },
  { c: "#59b86b", label: "Yeşil" },
  { c: "#a46be0", label: "Mor" },
  { c: "#16171c", label: "Siyah" },
  { c: "#ffffff", label: "Beyaz" },
];
const BACKS = ["#2a2c36", "#5a4413", "#3a1414", "#14303a", "#1f3a1f", "#ffffff", null];

/**
 * opts.secret: oturum anahtari, opts.onDone(url, name): token kaydedilince.
 */
export function openTokenMaker({ secret, onDone, name = "" }) {
  let img = null;
  let zoom = 1, ox = 0, oy = 0; // resim merkezinin daire merkezine gore kaymasi (cikti pikseli)
  let ring = RINGS[1].c;
  let ringW = 0.06;
  let back = BACKS[0];

  const preview = h("canvas.tm-canvas", { width: SIZE, height: SIZE });
  const pctx = preview.getContext("2d");
  const fileIn = h("input", { type: "file", accept: "image/*", hidden: true });
  const nameIn = h("input.input", { value: name, maxLength: 40, placeholder: "örn. Kara Şövalye" });
  const zoomIn = h("input.snd-range", { type: "range", min: 0.2, max: 4, step: 0.01, value: 1 });
  const empty = h("div.tm-empty", icon("upload"), h("b", "Resim seç"), h("span", "ya da buraya sürükle, Ctrl+V ile yapıştır"));
  const stage = h("div.tm-stage", preview, empty);

  function draw(target, forExport) {
    const c = target.getContext("2d");
    c.clearRect(0, 0, SIZE, SIZE);
    const r = SIZE / 2;
    c.save();
    c.beginPath();
    c.arc(r, r, r - (ring ? SIZE * ringW / 2 : 0), 0, Math.PI * 2);
    c.clip();
    if (back) { c.fillStyle = back; c.fillRect(0, 0, SIZE, SIZE); }
    if (img) {
      const base = Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
      const w = img.naturalWidth * base * zoom, hgt = img.naturalHeight * base * zoom;
      c.drawImage(img, r + ox - w / 2, r + oy - hgt / 2, w, hgt);
    }
    c.restore();
    if (ring) {
      c.beginPath();
      c.arc(r, r, r - SIZE * ringW / 2, 0, Math.PI * 2);
      c.lineWidth = SIZE * ringW;
      c.strokeStyle = ring;
      c.stroke();
      // ince ic golge cizgisi
      c.beginPath();
      c.arc(r, r, r - SIZE * ringW, 0, Math.PI * 2);
      c.lineWidth = 2;
      c.strokeStyle = "rgba(0,0,0,.35)";
      c.stroke();
    }
    if (!forExport) {
      // Disarida kalacak alani soluk goster
      c.save();
      c.globalCompositeOperation = "destination-over";
      c.globalAlpha = 0.25;
      if (img) {
        const base = Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
        const w = img.naturalWidth * base * zoom, hgt = img.naturalHeight * base * zoom;
        c.drawImage(img, r + ox - w / 2, r + oy - hgt / 2, w, hgt);
      }
      c.restore();
    }
  }

  const render = () => { draw(preview, false); empty.hidden = !!img; };

  function load(file) {
    if (!file || !file.type.startsWith("image/")) return toast("Bir resim dosyası seç.", "error");
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      img = im; zoom = 1; ox = 0; oy = 0; zoomIn.value = 1;
      if (!nameIn.value.trim() && file.name && !/^image\./i.test(file.name)) {
        nameIn.value = file.name.replace(/\.\w+$/, "").replace(/[-_]+/g, " ").slice(0, 40);
      }
      render();
    };
    im.onerror = () => toast("Resim açılamadı.", "error");
    im.src = url;
  }

  // Surukleyerek konumlandirma
  let dragFrom = null;
  preview.addEventListener("pointerdown", (e) => {
    if (!img) { fileIn.click(); return; }
    preview.setPointerCapture(e.pointerId);
    dragFrom = { x: e.clientX, y: e.clientY, ox, oy, k: SIZE / preview.getBoundingClientRect().width };
  });
  preview.addEventListener("pointermove", (e) => {
    if (!dragFrom) return;
    ox = dragFrom.ox + (e.clientX - dragFrom.x) * dragFrom.k;
    oy = dragFrom.oy + (e.clientY - dragFrom.y) * dragFrom.k;
    render();
  });
  preview.addEventListener("pointerup", () => { dragFrom = null; });
  preview.addEventListener("wheel", (e) => {
    if (!img) return;
    e.preventDefault();
    zoom = Math.max(0.2, Math.min(4, zoom * Math.exp(-e.deltaY * 0.0015)));
    zoomIn.value = zoom;
    render();
  }, { passive: false });
  empty.addEventListener("click", () => fileIn.click());
  zoomIn.addEventListener("input", () => { zoom = Number(zoomIn.value); render(); });
  fileIn.addEventListener("change", () => { load(fileIn.files[0]); fileIn.value = ""; });
  stage.addEventListener("dragover", (e) => { e.preventDefault(); stage.classList.add("over"); });
  stage.addEventListener("dragleave", () => stage.classList.remove("over"));
  stage.addEventListener("drop", (e) => {
    e.preventDefault();
    stage.classList.remove("over");
    load(e.dataTransfer.files[0]);
  });
  const onPaste = (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (item) { e.preventDefault(); load(item.getAsFile()); }
  };
  document.addEventListener("paste", onPaste);

  const swatchRow = (list, current, onPick, labelOf) => h("div.swatches.small", list.map((c) => h("button.swatch", {
    type: "button", title: labelOf(c), class: c === current ? "on" : "",
    style: c ? { background: c } : { background: "repeating-conic-gradient(#555 0 25%, #333 0 50%) 50% / 10px 10px" },
    onClick: (e) => {
      onPick(c);
      e.currentTarget.parentElement.querySelectorAll(".swatch").forEach((x) => x.classList.remove("on"));
      e.currentTarget.classList.add("on");
      render();
    },
  })));

  const thick = h("div.seg", [["İnce", 0.035], ["Orta", 0.06], ["Kalın", 0.1]].map(([l, v]) => h("button", {
    type: "button", class: v === ringW ? "on" : "",
    onClick: (e) => {
      ringW = v;
      thick.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === e.currentTarget));
      render();
    },
  }, l)));

  async function save() {
    if (!img) return toast("Önce bir resim seç.", "error");
    const nm = nameIn.value.trim() || "Token";
    const out = h("canvas", { width: SIZE, height: SIZE });
    draw(out, true);
    const blob = await new Promise((res) => out.toBlob(res, "image/png"));
    const safe = nm.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "token";
    try {
      saveBtn.disabled = true;
      const res = await uploadImage(new File([blob], safe + ".png", { type: "image/png" }), "tokens", secret);
      toast("Token hazır! 🎨", "ok");
      close();
      onDone && onDone(res.url, nm);
    } catch (err) {
      toast(err.message, "error");
      saveBtn.disabled = false;
    }
  }

  const saveBtn = h("button.btn.primary", { type: "button", onClick: save }, "Kaydet ve kullan");
  const overlay = h("div.modal.tm-overlay",
    h("div.modal-box.tm-box",
      h("header.modal-head", h("h2", "Token yapıcı"),
        h("button.icon-btn", { type: "button", title: "Kapat", onClick: () => close() }, icon("x"))),
      h("div.modal-body",
        h("div.tm-layout",
          h("div",
            stage,
            h("label.field", { style: { marginTop: "10px" } }, h("span", "Yakınlaştır (ya da tekerlek)"), zoomIn),
            h("p.muted.small-text", { style: { margin: "4px 0 0" } }, "Resmi sürükleyerek yüzü ortala."),
            h("button.btn.small", { type: "button", style: { marginTop: "8px" }, onClick: () => fileIn.click() }, icon("upload", "ico"), "Başka resim")),
          h("div.stack",
            h("label.field", h("span", "İsim"), nameIn),
            h("div.field", h("span", "Çerçeve"), swatchRow(RINGS.map((r) => r.c), ring, (c) => { ring = c; }, (c) => (RINGS.find((r) => r.c === c) || {}).label)),
            h("div.field", h("span", "Çerçeve kalınlığı"), thick),
            h("div.field", h("span", "Arka plan (şeffaf resimler için)"), swatchRow(BACKS, back, (c) => { back = c; }, (c) => (c ? c : "Şeffaf"))),
            h("div.form-foot", h("button.btn.ghost", { type: "button", onClick: () => close() }, "Vazgeç"), saveBtn))),
        fileIn)));

  function close() {
    document.removeEventListener("paste", onPaste);
    overlay.remove();
  }
  overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);
  render();
}
