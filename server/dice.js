// Zar ifadesi cozumleyici: "1d20+5", "2d6+1d4-1", "2d20kh1+3" (avantaj), "4d6kh3", "d%"
import { randomInt } from "node:crypto";

const TERM =/([+-])?(?:(\d*)d(\d+|%)(?:(kh|kl|k)(\d+)?)?|(\d+))/y;

export function rollExpression(input) {
  const src = String(input || "").toLowerCase().replace(/\s+/g, "");
  if (!src) throw new Error("Zar ifadesi boş.");
  if (src.length > 80) throw new Error("Zar ifadesi çok uzun.");

  const parts = [];
  let total = 0;
  let pos = 0;
  let diceUsed = 0;

  while (pos < src.length) {
    TERM.lastIndex = pos;
    const m = TERM.exec(src);
    if (!m || m[0] === "" || (pos > 0 && !m[1])) {
      throw new Error(`"${input}" anlaşılamadı. Örnek: 1d20+5 veya 2d6`);
    }
    pos = TERM.lastIndex;
    const sign = m[1] === "-" ? -1 : 1;

    if (m[6] !== undefined) {
      const value = Number(m[6]);
      if (value > 10000) throw new Error("Sabit sayı çok büyük.");
      parts.push({ type: "mod", value: sign * value });
      total += sign * value;
      continue;
    }

    const count = m[2] === "" ? 1 : Number(m[2]);
    const sides = m[3] === "%" ? 100 : Number(m[3]);
    if (count < 1 || count > 100) throw new Error("Bir seferde 1-100 zar atılabilir.");
    if (sides < 2 || sides > 1000) throw new Error("Zar yüzü 2 ile 1000 arasında olmalı.");
    diceUsed += count;
    if (diceUsed > 200) throw new Error("Toplam zar sayısı çok fazla.");

    const rolls = [];
    for (let i = 0; i < count; i++) rolls.push({ v: randomInt(1, sides + 1), dropped: false });

    let keep = null;
    if (m[4]) {
      const k = Math.min(count, Math.max(1, m[5] ? Number(m[5]) : 1));
      keep = (m[4] === "kl" ? "kl" : "kh") + k;
      const order = rolls.map((r, i) => i).sort((a, b) =>
        m[4] === "kl" ? rolls[a].v - rolls[b].v : rolls[b].v - rolls[a].v);
      order.slice(k).forEach((i) => { rolls[i].dropped = true; });
    }

    const sum = rolls.reduce((s, r) => s + (r.dropped ? 0 : r.v), 0);
    total += sign * sum;
    parts.push({ type: "dice", sign, count, sides, keep, rolls });
  }

  return { expr: formatParts(parts), total, parts };
}

function formatParts(parts) {
  return parts.map((p, i) => {
    const neg = p.type === "mod" ? p.value < 0 : p.sign < 0;
    const op = neg ? "-" : i > 0 ? "+" : "";
    const body = p.type === "mod" ? String(Math.abs(p.value)) : `${p.count}d${p.sides}${p.keep || ""}`;
    return op + body;
  }).join("");
}
