// Gorus (gorunurluk cokgeni) ve alan sablonu geometrisi

/** Isin ile dogru parcasi kesisimi: isin parametresi t (>=0) ya da null */
function raySegment(ox, oy, dx, dy, x1, y1, x2, y2) {
  const sx = x2 - x1, sy = y2 - y1;
  const den = dx * sy - dy * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((x1 - ox) * sy - (y1 - oy) * sx) / den;
  const u = ((x1 - ox) * dy - (y1 - oy) * dx) / den;
  if (t >= 0 && u >= -1e-9 && u <= 1 + 1e-9) return t;
  return null;
}

/**
 * Bir noktadan gorulen alanin cokgeni. walls: [[x1,y1,x2,y2], ...]
 * radius: arama karesinin yari genisligi (gorus menzili).
 * Donen: [x0,y0,x1,y1,...] (aci sirali)
 */
export function visibilityPolygon(ox, oy, walls, radius) {
  const R = radius;
  const box = [
    [ox - R, oy - R, ox + R, oy - R], [ox + R, oy - R, ox + R, oy + R],
    [ox + R, oy + R, ox - R, oy + R], [ox - R, oy + R, ox - R, oy - R],
  ];
  // Menzil disindaki duvarlari ele
  const segs = box.slice();
  for (const w of walls) {
    const minX = Math.min(w[0], w[2]), maxX = Math.max(w[0], w[2]);
    const minY = Math.min(w[1], w[3]), maxY = Math.max(w[1], w[3]);
    if (maxX < ox - R || minX > ox + R || maxY < oy - R || minY > oy + R) continue;
    segs.push(w);
  }

  const angles = [];
  for (const s of segs) {
    for (const [px, py] of [[s[0], s[1]], [s[2], s[3]]]) {
      const a = Math.atan2(py - oy, px - ox);
      angles.push(a - 1e-4, a, a + 1e-4);
    }
  }

  const pts = [];
  for (const a of angles) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = Infinity;
    for (const s of segs) {
      const t = raySegment(ox, oy, dx, dy, s[0], s[1], s[2], s[3]);
      if (t !== null && t < best) best = t;
    }
    if (best === Infinity) continue;
    pts.push({ a, x: ox + dx * best, y: oy + dy * best });
  }
  pts.sort((p, q) => p.a - q.a);
  const out = [];
  for (const p of pts) out.push(p.x, p.y);
  return out;
}

export function polygonPath(ctx, poly) {
  ctx.beginPath();
  if (poly.length < 6) return;
  ctx.moveTo(poly[0], poly[1]);
  for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
  ctx.closePath();
}

export function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - x1) * dx + (py - y1) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/* ---------------- Alan sablonlari (5e) ---------------- */

export const SHAPE_LABEL = { circle: "Daire", cone: "Koni", line: "Çizgi", square: "Kare" };

/** Sablonun dunya koordinatlarindaki cokgeni (daire icin null) */
export function templatePolygon(t, cell) {
  const L = (t.size / 5) * cell;
  const ca = Math.cos(t.angle), sa = Math.sin(t.angle);
  if (t.shape === "cone") {
    // Ucgen: herhangi bir noktadaki genislik, kokene olan uzakliga esit
    const ex = t.x + ca * L, ey = t.y + sa * L;
    const nx = -sa * (L / 2), ny = ca * (L / 2);
    return [t.x, t.y, ex + nx, ey + ny, ex - nx, ey - ny];
  }
  if (t.shape === "line") {
    const w = cell / 2;
    const nx = -sa * w, ny = ca * w;
    const ex = t.x + ca * L, ey = t.y + sa * L;
    return [t.x + nx, t.y + ny, ex + nx, ey + ny, ex - nx, ey - ny, t.x - nx, t.y - ny];
  }
  if (t.shape === "square") {
    const h = L / 2;
    return [t.x - h, t.y - h, t.x + h, t.y - h, t.x + h, t.y + h, t.x - h, t.y + h];
  }
  return null;
}

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inTemplate(t, cell, x, y) {
  if (t.shape === "circle") return Math.hypot(x - t.x, y - t.y) <= (t.size / 5) * cell + 0.5;
  return pointInPolygon(x, y, templatePolygon(t, cell));
}
