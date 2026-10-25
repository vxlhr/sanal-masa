// Harita tahtasi: tek bir canvas uzerinde harita, grid, cizimler, sablonlar, sis, gorus,
// tokenlar, duvarlar ve anlik isaretler. Tum fare/dokunma etkilesimi burada.
import { throttle, initials } from "./util.js";
import { visibilityPolygon, polygonPath, segDist, templatePolygon, inTemplate, SHAPE_LABEL } from "./geometry.js";

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const FEET_PER_CELL = 5;

export function createBoard({ canvas, stage, app }) {
  const ctx = canvas.getContext("2d");
  const fogCanvas = document.createElement("canvas");
  const fctx = fogCanvas.getContext("2d");
  const visCanvas = document.createElement("canvas");
  const vctx = visCanvas.getContext("2d");
  const tmpCanvas = document.createElement("canvas");
  const tctx = tmpCanvas.getContext("2d");

  const view = { x: 0, y: 0, s: 1 };
  let W = 0, H = 0, dpr = 1;
  let frame = 0;

  const images = new Map();
  let tool = "select";
  const drawOpts = { color: "#e05d5d", width: 5, erase: false };
  const fogOpts = { mode: "reveal" };
  const wallOpts = { mode: "wall", snap: true };
  const templateOpts = { shape: "circle" };
  let selectedId = null; // birincil secim (kart icin)
  const selectedIds = new Set();
  let sceneId = null;
  let fittedFor = null;

  // Etkilesim durumlari
  const pointers = new Map();
  let pinch = null;
  let pan = null;
  let drag = null; // { ids, offsets, lead, moved, ... }
  let box = null; // kutu secimi
  let measureLocal = null;
  let stroke = null;
  let fogRect = null;
  let erasing = false;
  let spaceDown = false;
  let wallChain = null; // [x,y,...] duvar cizimi
  let hoverPoint = null;
  let templateDraft = null;

  const remoteDrags = new Map();
  const pendingMoves = new Map();
  const measures = new Map();
  const pings = [];
  let visionCache = { key: "", polys: null };

  const sendDrag = throttle((id, x, y) => app.send({ t: "token.drag", id, x, y }), 50);
  const sendMeasure = throttle((line) => app.send({ t: "measure", line }), 60);

  /* ------------------------------------------------------------ */
  /* Yardimcilar                                                   */
  /* ------------------------------------------------------------ */

  const scene = () => app.state && app.state.scene;
  const you = () => app.state && app.state.you;
  const grid = () => (scene() ? scene().grid : { size: 70, offsetX: 0, offsetY: 0 });
  const canControl = (t) => !!you() && (you().isDm || t.ownerId === you().id);
  const ftToPx = (ft) => ((Number(ft) || 0) / FEET_PER_CELL) * grid().size;

  function image(url) {
    if (!url) return null;
    let e = images.get(url);
    if (!e) {
      e = { img: new Image(), ok: false };
      e.img.onload = () => { e.ok = true; onImageLoad(url); requestRender(); };
      e.img.src = url;
      images.set(url, e);
    }
    return e.ok ? e.img : null;
  }

  function onImageLoad(url) {
    const s = scene();
    if (s && s.map === url && fittedFor !== s.id) fit();
  }

  function mapSize() {
    const s = scene();
    const img = s && image(s.map);
    return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
  }

  function toMap(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.s, y: (clientY - r.top - view.y) / view.s };
  }

  function tokenPos(t) {
    if (drag && drag.moved && drag.offsets.has(t.id)) {
      const o = drag.offsets.get(t.id);
      return { x: drag.x + o.dx, y: drag.y + o.dy };
    }
    const p = pendingMoves.get(t.id) || remoteDrags.get(t.id);
    return p ? { x: p.x, y: p.y } : { x: t.x, y: t.y };
  }

  function tokenCenter(t) {
    const p = tokenPos(t);
    const h = (t.size * grid().size) / 2;
    return { x: p.x + h, y: p.y + h };
  }

  function snapPos(x, y) {
    const g = grid();
    return {
      x: Math.round((x - g.offsetX) / g.size) * g.size + g.offsetX,
      y: Math.round((y - g.offsetY) / g.size) * g.size + g.offsetY,
    };
  }

  /** Duvarlar icin en yakin izgara kosesi ya da hucre kenarinin ortasi */
  function snapCorner(x, y) {
    if (!wallOpts.snap) return { x, y };
    const g = grid();
    const half = g.size / 2;
    return {
      x: Math.round((x - g.offsetX) / half) * half + g.offsetX,
      y: Math.round((y - g.offsetY) / half) * half + g.offsetY,
    };
  }

  function cellCenter(x, y) {
    const g = grid();
    return {
      x: Math.floor((x - g.offsetX) / g.size) * g.size + g.offsetX + g.size / 2,
      y: Math.floor((y - g.offsetY) / g.size) * g.size + g.offsetY + g.size / 2,
    };
  }

  function distanceLabel(x1, y1, x2, y2) {
    const g = grid().size;
    const cells = Math.round(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / g);
    return `${cells} kare · ${cells * FEET_PER_CELL} ft`;
  }

  function orderedTokens() {
    const s = scene();
    if (!s) return [];
    const list = s.tokens.slice();
    list.sort((a, b) => b.size - a.size);
    const lead = drag ? drag.lead : selectedId;
    const top = list.findIndex((t) => t.id === lead);
    if (top >= 0) list.push(list.splice(top, 1)[0]);
    return list;
  }

  function hitToken(mx, my) {
    const list = orderedTokens();
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      const c = tokenCenter(t);
      const r = (t.size * grid().size) / 2;
      if ((mx - c.x) ** 2 + (my - c.y) ** 2 <= r * r) return t;
    }
    return null;
  }

  function hitDrawing(mx, my) {
    const s = scene();
    if (!s) return null;
    const tol = 8 / view.s;
    for (let i = s.drawings.length - 1; i >= 0; i--) {
      const d = s.drawings[i];
      const pts = d.points;
      for (let j = 0; j + 3 < pts.length; j += 2) {
        if (segDist(mx, my, pts[j], pts[j + 1], pts[j + 2], pts[j + 3]) <= tol + d.width / 2) return d;
      }
    }
    return null;
  }

  function hitWall(mx, my, doorsOnly) {
    const s = scene();
    if (!s) return null;
    const tol = 10 / view.s;
    let best = null, bestD = tol;
    for (const w of s.walls) {
      if (doorsOnly && !w.door) continue;
      const d = segDist(mx, my, ...w.c);
      if (d <= bestD) { best = w; bestD = d; }
    }
    return best;
  }

  function hitTemplate(mx, my) {
    const s = scene();
    if (!s) return null;
    for (let i = s.templates.length - 1; i >= 0; i--) {
      if (inTemplate(s.templates[i], grid().size, mx, my)) return s.templates[i];
    }
    return null;
  }

  /* ------------------------------------------------------------ */
  /* Gorunum                                                       */
  /* ------------------------------------------------------------ */

  function resize() {
    const r = stage.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height;
    for (const c of [canvas, fogCanvas, visCanvas, tmpCanvas]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const s = scene();
    if (W && s && fittedFor !== s.id && (mapSize() || !s.map)) fit();
    requestRender();
  }

  function zoomAt(sx, sy, factor) {
    const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.s * factor));
    view.x = sx - (sx - view.x) * (ns / view.s);
    view.y = sy - (sy - view.y) * (ns / view.s);
    view.s = ns;
    app.onZoom(view.s);
    requestRender();
  }

  function zoomBy(factor) { zoomAt(W / 2, H / 2, factor); }

  function fit() {
    const s = scene();
    if (!s || !W) return;
    const ms = mapSize();
    if (ms) {
      view.s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(W / ms.w, H / ms.h) * 0.94));
      view.x = (W - ms.w * view.s) / 2;
      view.y = (H - ms.h * view.s) / 2;
      fittedFor = s.id;
    } else if (s.tokens.length) {
      const xs = s.tokens.map((t) => t.x), ys = s.tokens.map((t) => t.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      view.s = 1;
      view.x = W / 2 - cx; view.y = H / 2 - cy;
    } else {
      view.s = 1; view.x = W / 2; view.y = H / 2;
    }
    app.onZoom(view.s);
    requestRender();
  }

  function centerOn(t) {
    const S = t.size * grid().size;
    view.x = W / 2 - (t.x + S / 2) * view.s;
    view.y = H / 2 - (t.y + S / 2) * view.s;
    requestRender();
  }

  function viewCenter() {
    return { x: (W / 2 - view.x) / view.s, y: (H / 2 - view.y) / view.s };
  }

  /* ------------------------------------------------------------ */
  /* Cizim                                                         */
  /* ------------------------------------------------------------ */

  function requestRender() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  const worldTransform = (c) => c.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.x, dpr * view.y);

  function render() {
    frame = 0;
    const now = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0b0c0f";
    ctx.fillRect(0, 0, W, H);

    const s = scene();
    if (!s) return;
    const me = you();

    worldTransform(ctx);

    const map = image(s.map);
    const ms = mapSize();
    if (map) {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.6)";
      ctx.shadowBlur = 30;
      ctx.drawImage(map, 0, 0);
      ctx.restore();
    }

    drawGrid(s, ms);
    drawDrawings(s);
    if (stroke) drawStroke(stroke.points, stroke.color, stroke.width);
    drawTemplates(s);
    drawDoors(s, me.isDm);

    // Sis (elle acilan alanlar) ve dinamik gorus: oyuncu icin karanlik
    if (s.fog.enabled) drawFog(s, me.isDm);
    if (s.vision.enabled && !me.isDm) drawVision(s);
    if (fogRect) drawFogRect();

    const currentId = s.combat.active ? s.combat.currentTokenId : null;
    for (const t of orderedTokens()) drawToken(s, t, currentId, now);

    if (me.isDm) drawWalls(s);
    if (wallChain) drawWallDraft();
    if (templateDraft) drawTemplate(templateDraft, true);
    if (drag && drag.moved) drawDragInfo(s);
    if (box) drawBox();

    for (const m of measures.values()) if (m.line) drawMeasure(m.line, m.color, m.name);
    if (measureLocal) drawMeasure(measureLocal, me.color, null);

    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i];
      const age = (now - p.t0) / 1600;
      if (age >= 1) { pings.splice(i, 1); continue; }
      drawPing(p, age);
    }
    if (pings.length || currentId) requestRender();
  }

  function drawGrid(s, ms) {
    const g = s.grid;
    if (!g.show || g.size * view.s < 6) return;
    let x0, y0, x1, y1;
    if (ms) { x0 = 0; y0 = 0; x1 = ms.w; y1 = ms.h; }
    else {
      x0 = -view.x / view.s; y0 = -view.y / view.s;
      x1 = (W - view.x) / view.s; y1 = (H - view.y) / view.s;
    }
    x0 = Math.max(x0, -view.x / view.s); y0 = Math.max(y0, -view.y / view.s);
    x1 = Math.min(x1, (W - view.x) / view.s); y1 = Math.min(y1, (H - view.y) / view.s);
    if (x1 <= x0 || y1 <= y0) return;

    ctx.save();
    ctx.globalAlpha = g.opacity;
    ctx.strokeStyle = g.color;
    ctx.lineWidth = 1 / view.s;
    ctx.beginPath();
    const sx = Math.ceil((x0 - g.offsetX) / g.size) * g.size + g.offsetX;
    for (let x = sx; x <= x1; x += g.size) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    const sy = Math.ceil((y0 - g.offsetY) / g.size) * g.size + g.offsetY;
    for (let y = sy; y <= y1; y += g.size) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
    ctx.restore();
  }

  function drawStroke(pts, color, width) {
    if (pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    if (pts.length === 2) ctx.lineTo(pts[0] + 0.01, pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
    ctx.restore();
  }

  function drawDrawings(s) {
    for (const d of s.drawings) drawStroke(d.points, d.color, d.width);
  }

  /* ---------------- Sablonlar ---------------- */

  function drawTemplates(s) {
    for (const t of s.templates) drawTemplate(t, false);
  }

  function drawTemplate(t, draft) {
    const cell = grid().size;
    const u = 1 / view.s;
    ctx.save();
    ctx.fillStyle = hexA(t.color, draft ? 0.28 : 0.22);
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 2 * u;
    if (t.shape === "circle") {
      ctx.beginPath();
      ctx.arc(t.x, t.y, (t.size / 5) * cell, 0, Math.PI * 2);
    } else {
      polygonPath(ctx, templatePolygon(t, cell));
    }
    ctx.fill();
    ctx.stroke();

    // Etiket: boyut ve icindeki hedef sayisi
    const s = scene();
    const hits = s ? s.tokens.filter((tk) => { const c = tokenCenter(tk); return inTemplate(t, cell, c.x, c.y); }).length : 0;
    const text = `${SHAPE_LABEL[t.shape]} ${t.size} ft${hits ? ` · ${hits} hedef` : ""}`;
    ctx.font = `700 ${12 * u}px Inter, sans-serif`;
    const tw = ctx.measureText(text).width + 12 * u;
    // Etiketi seklin ust kenarinin ustune koy ki tokenlari ortmesin
    let top = t.y - (t.size / 5) * cell;
    if (t.shape !== "circle") {
      const poly = templatePolygon(t, cell);
      for (let i = 1; i < poly.length; i += 2) top = Math.min(top, poly[i]);
    }
    const ly = top - 16 * u;
    ctx.fillStyle = "rgba(12,13,16,.88)";
    roundRect(t.x - tw / 2, ly - 10 * u, tw, 20 * u, 6 * u);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, t.x, ly);
    ctx.restore();
  }

  /* ---------------- Duvarlar ve kapilar ---------------- */

  function drawDoors(s) {
    const u = 1 / view.s;
    ctx.save();
    ctx.lineCap = "round";
    for (const w of s.walls) {
      if (!w.door) continue;
      const [x1, y1, x2, y2] = w.c;
      ctx.strokeStyle = w.open ? "rgba(92,191,117,.9)" : "#c98a3a";
      ctx.lineWidth = 6 * u;
      ctx.setLineDash(w.open ? [6 * u, 6 * u] : []);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawWalls(s) {
    const u = 1 / view.s;
    const show = tool === "wall" || s.vision.enabled;
    if (!show) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = 3 * u;
    for (const w of s.walls) {
      if (w.door) continue;
      ctx.strokeStyle = tool === "wall" ? "rgba(90,160,230,.95)" : "rgba(90,160,230,.45)";
      ctx.beginPath(); ctx.moveTo(w.c[0], w.c[1]); ctx.lineTo(w.c[2], w.c[3]); ctx.stroke();
    }
    if (tool === "wall") {
      ctx.fillStyle = "#5aa0e6";
      for (const w of s.walls) {
        ctx.beginPath(); ctx.arc(w.c[0], w.c[1], 3 * u, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(w.c[2], w.c[3], 3 * u, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Isik kaynaklari (DM icin ipucu)
    for (const L of s.lights || []) {
      ctx.strokeStyle = "rgba(255,210,110,.35)";
      ctx.setLineDash([6 * u, 6 * u]);
      ctx.beginPath(); ctx.arc(L.x, L.y, L.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawWallDraft() {
    const u = 1 / view.s;
    ctx.save();
    ctx.strokeStyle = wallOpts.mode === "door" ? "#c98a3a" : "#5aa0e6";
    ctx.lineWidth = 3 * u;
    ctx.setLineDash([8 * u, 5 * u]);
    ctx.beginPath();
    ctx.moveTo(wallChain[0], wallChain[1]);
    for (let i = 2; i < wallChain.length; i += 2) ctx.lineTo(wallChain[i], wallChain[i + 1]);
    if (hoverPoint) ctx.lineTo(hoverPoint.x, hoverPoint.y);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------- Sis ve gorus ---------------- */

  function drawFog(s, isDm) {
    if (!fogCanvas.width || !fogCanvas.height) return;
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
    fctx.globalCompositeOperation = "source-over";
    fctx.fillStyle = "#07080b";
    fctx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);
    worldTransform(fctx);
    for (const op of s.fog.ops) {
      fctx.globalCompositeOperation = op.type === "reveal" ? "destination-out" : "source-over";
      fctx.fillRect(op.x, op.y, op.w, op.h);
    }
    fctx.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = isDm ? 0.55 : 1;
    ctx.drawImage(fogCanvas, 0, 0);
    ctx.restore();
  }

  /** Oyuncunun tokenlarinin gorus cokgenleri (duvar/token degismedikce onbellekte) */
  function visionPolys(s) {
    const me = you();
    const walls = s.walls.filter((w) => !w.open).map((w) => w.c);
    const mine = s.tokens.filter((t) => t.ownerId === me.id);
    const big = 6000;
    const key = JSON.stringify([s.walls.map((w) => [w.id, w.open]), mine.map((t) => [tokenCenter(t), t.darkvision]), s.lights, s.vision]);
    if (visionCache.key === key) return visionCache.polys;
    const viewers = mine.map((t) => {
      const c = tokenCenter(t);
      return { x: c.x, y: c.y, dv: ftToPx(t.darkvision), poly: visibilityPolygon(c.x, c.y, walls, big) };
    });
    const lights = (s.lights || []).map((L) => ({ ...L, poly: visibilityPolygon(L.x, L.y, walls, L.r + 2) }));
    visionCache = { key, polys: { viewers, lights } };
    return visionCache.polys;
  }

  function drawVision(s) {
    if (!visCanvas.width) return;
    const { viewers, lights } = visionPolys(s);
    vctx.setTransform(1, 0, 0, 1, 0, 0);
    vctx.globalCompositeOperation = "source-over";
    vctx.clearRect(0, 0, visCanvas.width, visCanvas.height);
    vctx.fillStyle = "#050608";
    vctx.fillRect(0, 0, visCanvas.width, visCanvas.height);

    for (const v of viewers) {
      // Bu tokenin gorebildigi alan: duvarlarin izin verdigi bolge
      // karanlikta ayrica: karanlik gorus dairesi ya da isikli alan
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.globalCompositeOperation = "source-over";
      tctx.clearRect(0, 0, tmpCanvas.width, tmpCanvas.height);
      worldTransform(tctx);
      tctx.fillStyle = "#fff";
      if (!s.vision.dark) {
        polygonPath(tctx, v.poly);
        tctx.fill();
      } else {
        for (const L of lights) {
          tctx.save();
          tctx.beginPath(); tctx.arc(L.x, L.y, L.r, 0, Math.PI * 2); tctx.clip();
          polygonPath(tctx, L.poly); tctx.fill();
          tctx.restore();
        }
        if (v.dv > 0) { tctx.beginPath(); tctx.arc(v.x, v.y, v.dv, 0, Math.PI * 2); tctx.fill(); }
        tctx.globalCompositeOperation = "destination-in";
        polygonPath(tctx, v.poly);
        tctx.fill();
      }
      vctx.globalCompositeOperation = "destination-out";
      vctx.drawImage(tmpCanvas, 0, 0);
    }
    vctx.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(visCanvas, 0, 0);
    ctx.restore();
  }

  function drawFogRect() {
    const r = normRect(fogRect);
    ctx.save();
    const reveal = fogOpts.mode === "reveal";
    ctx.fillStyle = reveal ? "rgba(208,167,82,.15)" : "rgba(0,0,0,.45)";
    ctx.strokeStyle = reveal ? "#d0a752" : "#e0605a";
    ctx.lineWidth = 2 / view.s;
    ctx.setLineDash([8 / view.s, 6 / view.s]);
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  function drawBox() {
    const r = normRect(box);
    ctx.save();
    ctx.fillStyle = "rgba(208,167,82,.1)";
    ctx.strokeStyle = "#d0a752";
    ctx.lineWidth = 1.5 / view.s;
    ctx.setLineDash([6 / view.s, 4 / view.s]);
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  /* ---------------- Tokenlar ---------------- */

  function drawToken(s, t, currentId, now) {
    const p = tokenPos(t);
    const S = t.size * s.grid.size;
    const r = S / 2;
    const cx = p.x + r, cy = p.y + r;
    const ring = Math.max(2 / view.s, S * 0.05);
    const img = image(t.img);
    const me = you();

    ctx.save();
    if (t.hidden) ctx.globalAlpha = 0.5;

    if (t.id === currentId) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 300);
      ctx.beginPath();
      ctx.arc(cx, cy, r + ring * 2.2 + pulse * 3 / view.s, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(240, 200, 110, ${0.5 + pulse * 0.4})`;
      ctx.lineWidth = 3 / view.s;
      ctx.stroke();
    }

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.55)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r - ring / 2, 0, Math.PI * 2);
    ctx.fillStyle = "#23252d";
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - ring / 2, 0, Math.PI * 2);
    ctx.clip();
    if (img) {
      const k = Math.max(S / img.naturalWidth, S / img.naturalHeight);
      const w = img.naturalWidth * k, h = img.naturalHeight * k;
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    } else {
      ctx.fillStyle = t.color;
      ctx.globalAlpha *= 0.35;
      ctx.fillRect(p.x, p.y, S, S);
      ctx.globalAlpha = t.hidden ? 0.5 : 1;
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${S * 0.36}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials(t.name), cx, cy + S * 0.02);
    }
    const down = (t.maxHp && t.hp <= 0) || t.hpState === "down";
    if (down) {
      ctx.fillStyle = "rgba(10,10,12,.6)";
      ctx.fillRect(p.x, p.y, S, S);
      ctx.strokeStyle = "rgba(224,96,90,.9)";
      ctx.lineWidth = S * 0.07;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.45, cy - r * 0.45); ctx.lineTo(cx + r * 0.45, cy + r * 0.45);
      ctx.moveTo(cx + r * 0.45, cy - r * 0.45); ctx.lineTo(cx - r * 0.45, cy + r * 0.45);
      ctx.stroke();
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, r - ring / 2, 0, Math.PI * 2);
    ctx.strokeStyle = t.color;
    ctx.lineWidth = ring;
    if (t.hidden) ctx.setLineDash([ring * 2, ring * 1.5]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (selectedIds.has(t.id)) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 3 / view.s, 0, Math.PI * 2);
      ctx.strokeStyle = t.id === selectedId ? "#f3d28a" : "rgba(243,210,138,.6)";
      ctx.lineWidth = 2.5 / view.s;
      ctx.stroke();
    }

    const u = 1 / view.s;

    if (t.maxHp > 0) {
      const bw = Math.max(S * 0.8, 36 * u), bh = 5 * u;
      const bx = cx - bw / 2, by = p.y + S + 2 * u;
      const f = Math.max(0, Math.min(1, t.hp / t.maxHp));
      ctx.fillStyle = "rgba(0,0,0,.75)";
      roundRect(bx - u, by - u, bw + 2 * u, bh + 2 * u, 3 * u); ctx.fill();
      ctx.fillStyle = f > 0.5 ? "#5cbf75" : f > 0.25 ? "#d6a63a" : "#e0605a";
      if (f > 0) { roundRect(bx, by, bw * f, bh, 2.5 * u); ctx.fill(); }
    } else if (t.hpState === "bloodied") {
      ctx.beginPath();
      ctx.arc(p.x + S - r * 0.25, p.y + r * 0.25, 6 * u, 0, Math.PI * 2);
      ctx.fillStyle = "#e0605a";
      ctx.fill();
      ctx.strokeStyle = "#111"; ctx.lineWidth = 1.5 * u; ctx.stroke();
    }

    if (t.conditions && t.conditions.length) {
      const bx = p.x + r * 0.25, by = p.y + r * 0.25;
      ctx.beginPath();
      ctx.arc(bx, by, 8 * u, 0, Math.PI * 2);
      ctx.fillStyle = "#8c5ad6";
      ctx.fill();
      ctx.strokeStyle = "#111"; ctx.lineWidth = 1.5 * u; ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${10 * u}px Inter, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(t.conditions.length), bx, by + 0.5 * u);
    }

    if (view.s * S > 22) {
      ctx.font = `600 ${12 * u}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = t.name + (t.ownerId && t.ownerId === me.id && !me.isDm ? " (sen)" : "");
      const tw = ctx.measureText(label).width + 12 * u;
      const ly = p.y + S + (t.maxHp > 0 ? 18 : 12) * u;
      ctx.fillStyle = "rgba(12,13,16,.85)";
      roundRect(cx - tw / 2, ly - 9 * u, tw, 18 * u, 9 * u); ctx.fill();
      ctx.fillStyle = "#f1ede4";
      ctx.fillText(label, cx, ly + 0.5 * u);
    }
    ctx.restore();
  }

  function drawDragInfo(s) {
    const t = s.tokens.find((x) => x.id === drag.lead);
    if (!t) return;
    const S = t.size * s.grid.size;
    const snap = snapPos(drag.x, drag.y);
    ctx.save();
    ctx.strokeStyle = "rgba(243,210,138,.8)";
    ctx.fillStyle = "rgba(243,210,138,.12)";
    ctx.lineWidth = 2 / view.s;
    ctx.setLineDash([6 / view.s, 4 / view.s]);
    ctx.fillRect(snap.x, snap.y, S, S);
    ctx.strokeRect(snap.x, snap.y, S, S);
    ctx.restore();
    drawMeasure([drag.startX + S / 2, drag.startY + S / 2, snap.x + S / 2, snap.y + S / 2], "#f3d28a", null);
  }

  function drawMeasure(line, color, name) {
    const [x1, y1, x2, y2] = line;
    const u = 1 / view.s;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3 * u;
    ctx.setLineDash([10 * u, 6 * u]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x1, y1, 5 * u, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x2, y2, 5 * u, 0, Math.PI * 2); ctx.fill();

    const text = distanceLabel(x1, y1, x2, y2) + (name ? ` — ${name}` : "");
    ctx.font = `700 ${13 * u}px Inter, sans-serif`;
    const tw = ctx.measureText(text).width + 16 * u;
    const lx = x2 + 14 * u, ly = y2 - 14 * u;
    ctx.fillStyle = "rgba(12,13,16,.92)";
    roundRect(lx, ly - 12 * u, tw, 24 * u, 6 * u); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1.5 * u; ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(text, lx + 8 * u, ly + 0.5 * u);
    ctx.restore();
  }

  function drawPing(p, age) {
    const u = 1 / view.s;
    ctx.save();
    for (let k = 0; k < 2; k++) {
      const a = (age + k * 0.3) % 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (10 + a * 50) * u, 0, Math.PI * 2);
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = (1 - a) * (1 - age * 0.6);
      ctx.lineWidth = 4 * u;
      ctx.stroke();
    }
    ctx.globalAlpha = 1 - age;
    ctx.beginPath(); ctx.arc(p.x, p.y, 7 * u, 0, Math.PI * 2);
    ctx.fillStyle = p.color; ctx.fill();
    if (p.name) {
      ctx.font = `700 ${12 * u}px Inter, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.lineWidth = 3 * u; ctx.strokeStyle = "rgba(0,0,0,.8)";
      ctx.strokeText(p.name, p.x, p.y - 16 * u);
      ctx.fillStyle = "#fff"; ctx.fillText(p.name, p.x, p.y - 16 * u);
    }
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function normRect(r) {
    return { x: Math.min(r.x1, r.x2), y: Math.min(r.y1, r.y2), w: Math.abs(r.x2 - r.x1), h: Math.abs(r.y2 - r.y1) };
  }

  function hexA(hex, a) {
    const n = parseInt(String(hex).slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /* ------------------------------------------------------------ */
  /* Secim                                                         */
  /* ------------------------------------------------------------ */

  function select(id, add = false) {
    if (!add) selectedIds.clear();
    if (id) {
      if (add && selectedIds.has(id)) {
        selectedIds.delete(id);
        if (selectedId === id) selectedId = [...selectedIds].pop() || null;
      } else {
        selectedIds.add(id);
        selectedId = id;
      }
    } else if (!add) {
      selectedId = null;
    }
    app.onSelect(selectedId);
    requestRender();
  }

  function selectMany(ids) {
    selectedIds.clear();
    for (const id of ids) selectedIds.add(id);
    selectedId = ids[ids.length - 1] || null;
    app.onSelect(selectedId);
    requestRender();
  }

  /* ------------------------------------------------------------ */
  /* Fare / dokunma                                               */
  /* ------------------------------------------------------------ */

  function setStageClass(name, on) { stage.classList.toggle(name, !!on); }

  function cancelActions() {
    if (drag) { drag = null; sendDrag.cancel(); }
    stroke = null; fogRect = null; erasing = false; box = null; templateDraft = null;
    if (measureLocal) { measureLocal = null; sendMeasure.cancel(); app.send({ t: "measure", line: null }); }
    pan = null;
    setStageClass("dragging", false);
    setStageClass("panning", false);
    requestRender();
  }

  function finishWall() {
    if (wallChain && wallChain.length >= 4) {
      const segments = [];
      for (let i = 0; i + 3 < wallChain.length; i += 2) segments.push(wallChain.slice(i, i + 4));
      const ref = app.newRef();
      app.send({ t: "wall.add", segments, door: wallOpts.mode === "door", ref });
      app.recordCreate("walls", ref, "Duvar");
    }
    wallChain = null;
    hoverPoint = null;
    requestRender();
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!scene()) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      cancelActions();
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (pointers.size > 2) return;

    const m = toMap(e.clientX, e.clientY);

    if (e.button === 2 && tool === "wall" && wallChain) { finishWall(); return; }
    if (e.button === 1 || e.button === 2 || spaceDown) { startPan(e); return; }
    if (e.button !== 0) return;
    if (e.altKey || tool === "ping") { ping(m.x, m.y); return; }

    if (tool === "select") {
      const t = hitToken(m.x, m.y);
      if (t) {
        const additive = e.shiftKey || e.ctrlKey || e.metaKey;
        if (additive) { select(t.id, true); return; }
        if (!selectedIds.has(t.id)) select(t.id);
        else { selectedId = t.id; app.onSelect(t.id); }
        // Secili olan tum kontrol edilebilir tokenlar birlikte suruklenir
        const ids = [...selectedIds].filter((id) => {
          const x = scene().tokens.find((k) => k.id === id);
          return x && canControl(x);
        });
        if (canControl(t)) {
          const p = tokenPos(t);
          const offsets = new Map();
          for (const id of ids) {
            const x = scene().tokens.find((k) => k.id === id);
            const xp = tokenPos(x);
            offsets.set(id, { dx: xp.x - p.x, dy: xp.y - p.y, ox: x.x, oy: x.y });
          }
          drag = { lead: t.id, offsets, offX: m.x - p.x, offY: m.y - p.y, x: p.x, y: p.y, startX: p.x, startY: p.y, sx: e.clientX, sy: e.clientY, moved: false };
        } else {
          startPan(e);
        }
        return;
      }
      const door = hitWall(m.x, m.y, true);
      if (door) { app.send({ t: "door.toggle", id: door.id }); return; }
      if (e.shiftKey) {
        box = { x1: m.x, y1: m.y, x2: m.x, y2: m.y };
      } else {
        select(null);
        startPan(e);
      }
    } else if (tool === "measure") {
      const c = cellCenter(m.x, m.y);
      measureLocal = [c.x, c.y, c.x, c.y];
    } else if (tool === "draw") {
      if (drawOpts.erase) { erasing = true; eraseAt(m); }
      else stroke = { points: [m.x, m.y], color: drawOpts.color, width: drawOpts.width };
    } else if (tool === "fog" && you().isDm) {
      fogRect = { x1: m.x, y1: m.y, x2: m.x, y2: m.y };
    } else if (tool === "wall" && you().isDm) {
      if (wallOpts.mode === "erase") {
        const w = hitWall(m.x, m.y, false);
        if (w) app.send({ t: "wall.delete", id: w.id });
        return;
      }
      const p = snapCorner(m.x, m.y);
      if (!wallChain) wallChain = [p.x, p.y];
      else {
        const n = wallChain.length;
        if (Math.hypot(p.x - wallChain[n - 2], p.y - wallChain[n - 1]) < 2) { finishWall(); return; }
        wallChain.push(p.x, p.y);
        if (wallOpts.mode === "door") finishWall(); // kapi tek parca
      }
    } else if (tool === "template") {
      const own = hitTemplate(m.x, m.y);
      const g = grid();
      const origin = templateOpts.shape === "circle" || templateOpts.shape === "square"
        ? snapCorner(m.x, m.y) : cellCenter(m.x, m.y);
      templateDraft = { shape: templateOpts.shape, x: origin.x, y: origin.y, angle: 0, size: 5, color: you().color, sx: e.clientX, sy: e.clientY, hit: own, g };
    }
    requestRender();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const r = canvas.getBoundingClientRect();
      view.x += mx - pinch.mx; view.y += my - pinch.my;
      zoomAt(mx - r.left, my - r.top, dist / pinch.dist);
      pinch = { dist, mx, my };
      return;
    }

    const m = toMap(e.clientX, e.clientY);

    if (pan) {
      view.x = pan.vx + (e.clientX - pan.sx);
      view.y = pan.vy + (e.clientY - pan.sy);
      requestRender();
      return;
    }
    if (drag) {
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) {
        drag.moved = true;
        setStageClass("dragging", true);
      }
      if (drag.moved) {
        drag.x = m.x - drag.offX;
        drag.y = m.y - drag.offY;
        sendDrag(drag.lead, drag.x, drag.y);
        requestRender();
      }
      return;
    }
    if (box) { box.x2 = m.x; box.y2 = m.y; requestRender(); return; }
    if (measureLocal) {
      const c = cellCenter(m.x, m.y);
      measureLocal = [measureLocal[0], measureLocal[1], c.x, c.y];
      sendMeasure(measureLocal);
      requestRender();
      return;
    }
    if (stroke) {
      const n = stroke.points.length;
      if (Math.hypot(m.x - stroke.points[n - 2], m.y - stroke.points[n - 1]) > 2 / view.s) {
        stroke.points.push(m.x, m.y);
        requestRender();
      }
      return;
    }
    if (erasing) { eraseAt(m); return; }
    if (fogRect) {
      fogRect.x2 = m.x; fogRect.y2 = m.y;
      requestRender();
      return;
    }
    if (templateDraft) {
      const dx = m.x - templateDraft.x, dy = m.y - templateDraft.y;
      const ft = Math.max(5, Math.round(((Math.hypot(dx, dy) / grid().size) * FEET_PER_CELL) / 5) * 5);
      templateDraft.size = templateDraft.shape === "square" ? ft * 2 : ft;
      templateDraft.angle = Math.atan2(dy, dx);
      requestRender();
      return;
    }
    if (tool === "wall" && wallChain) {
      hoverPoint = snapCorner(m.x, m.y);
      requestRender();
      return;
    }

    if (tool === "select" && e.pointerType === "mouse") {
      const t = hitToken(m.x, m.y);
      const door = !t && hitWall(m.x, m.y, true);
      setStageClass("over-token", (t && !canControl(t)) || door);
      setStageClass("over-movable", t && canControl(t));
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      return;
    }

    if (pan) { pan = null; setStageClass("panning", false); }

    if (drag) {
      const d = drag;
      drag = null;
      setStageClass("dragging", false);
      if (d.moved) {
        sendDrag.cancel();
        const undoItems = [];
        for (const [id, o] of d.offsets) {
          const nx = d.x + o.dx, ny = d.y + o.dy;
          const snap = snapPos(nx, ny);
          pendingMoves.set(id, { x: snap.x, y: snap.y, ts: Date.now() });
          app.send({ t: "token.move", id, x: nx, y: ny });
          undoItems.push({ id, x: o.ox, y: o.oy });
        }
        app.recordUndo({
          label: undoItems.length > 1 ? `${undoItems.length} token taşıma` : "Token taşıma",
          undo: () => undoItems.forEach((it) => app.send({ t: "token.move", id: it.id, x: it.x, y: it.y })),
        });
      }
    }

    if (box) {
      const r = normRect(box);
      box = null;
      const ids = scene().tokens.filter((t) => {
        const c = tokenCenter(t);
        return c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h;
      }).map((t) => t.id);
      selectMany(ids);
    }

    if (measureLocal) {
      measureLocal = null;
      sendMeasure.cancel();
      app.send({ t: "measure", line: null });
    }

    if (stroke) {
      const pts = stroke.points.length === 2 ? [...stroke.points, stroke.points[0] + 0.5, stroke.points[1]] : stroke.points;
      const ref = app.newRef();
      app.send({ t: "draw.add", points: pts.map((v) => Math.round(v * 10) / 10), color: stroke.color, width: stroke.width, ref });
      app.recordCreate("draw", ref, "Çizim");
      const s = scene();
      if (s) s.drawings = [...s.drawings, { id: "local", ownerId: you().id, color: stroke.color, width: stroke.width, points: pts }];
      stroke = null;
    }

    erasing = false;

    if (fogRect) {
      const r = normRect(fogRect);
      fogRect = null;
      if (r.w * view.s > 4 && r.h * view.s > 4) {
        app.send({ t: "fog.op", type: fogOpts.mode, ...r });
        app.recordUndo({ label: "Sis", undo: () => app.send({ t: "fog.undo" }) });
      }
    }

    if (templateDraft) {
      const d = templateDraft;
      templateDraft = null;
      const clicked = Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5;
      if (clicked && d.hit && (you().isDm || d.hit.ownerId === you().id)) {
        app.send({ t: "template.delete", id: d.hit.id });
      } else if (!clicked) {
        const ref = app.newRef();
        app.send({ t: "template.add", shape: d.shape, x: d.x, y: d.y, angle: d.angle, size: d.size, ref });
        app.recordCreate("template", ref, "Şablon");
      }
    }
    requestRender();
  }

  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("dblclick", () => { if (tool === "wall" && wallChain) finishWall(); });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerleave", () => {
    setStageClass("over-token", false);
    setStageClass("over-movable", false);
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });

  function startPan(e) {
    pan = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    setStageClass("panning", true);
  }

  function eraseAt(m) {
    const d = hitDrawing(m.x, m.y);
    if (!d || d.id === "local") return;
    if (!you().isDm && d.ownerId !== you().id) return;
    const s = scene();
    s.drawings = s.drawings.filter((x) => x.id !== d.id);
    app.send({ t: "draw.delete", id: d.id });
    requestRender();
  }

  function ping(x, y) {
    app.send({ t: "ping", x, y });
    addPing({ x, y, color: you().color, name: "" });
  }

  function addPing(p) {
    pings.push({ ...p, t0: performance.now() });
    requestRender();
  }

  /* ------------------------------------------------------------ */
  /* Disaridan cagrilanlar                                         */
  /* ------------------------------------------------------------ */

  function onState() {
    const s = scene();
    const newId = s ? s.id : null;
    if (newId !== sceneId) {
      sceneId = newId;
      cancelActions();
      wallChain = null;
      remoteDrags.clear();
      pendingMoves.clear();
      measures.clear();
      selectedIds.clear();
      selectedId = null;
      app.onSelect(null);
      fittedFor = null;
      if (s) fit();
    }
    if (s) {
      for (const [id, p] of pendingMoves) {
        const t = s.tokens.find((x) => x.id === id);
        if (!t || (t.x === p.x && t.y === p.y) || Date.now() - p.ts > 3000) pendingMoves.delete(id);
      }
      remoteDrags.clear();
      for (const id of [...selectedIds]) if (!s.tokens.some((t) => t.id === id)) selectedIds.delete(id);
      if (selectedId && !selectedIds.has(selectedId)) { selectedId = [...selectedIds].pop() || null; app.onSelect(selectedId); }
      if (fittedFor !== s.id && mapSize()) fit();
    }
    requestRender();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();

  return {
    onState,
    requestRender,
    fit,
    zoomBy,
    centerOn,
    viewCenter,
    toScreen(x, y) {
      const r = canvas.getBoundingClientRect();
      return { x: r.left + view.x + x * view.s, y: r.top + view.y + y * view.s };
    },
    select,
    selectMany,
    get selectedId() { return selectedId; },
    get selectedIds() { return [...selectedIds]; },
    setTool(t) {
      cancelActions();
      if (tool === "wall" && t !== "wall") finishWall();
      tool = t;
      for (const c of [...stage.classList]) if (c.startsWith("tool-")) stage.classList.remove(c);
      stage.classList.add("tool-" + t);
      requestRender();
    },
    get tool() { return tool; },
    drawOpts,
    fogOpts,
    wallOpts,
    templateOpts,
    finishWall,
    cancelWall() { wallChain = null; hoverPoint = null; requestRender(); },
    get drawingWall() { return !!wallChain; },
    setSpace(on) { spaceDown = on; },
    remoteDrag(id, x, y) { remoteDrags.set(id, { x, y }); requestRender(); },
    remoteMeasure(m) {
      if (m.line) measures.set(m.id, m); else measures.delete(m.id);
      requestRender();
    },
    addPing,
    cancel: cancelActions,
  };
}
