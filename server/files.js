// Sabit dosyalar (public/ ve assets/). Normalde diskten okunur; tek dosyalik programda
// (Node "single executable application") programin icine gomulu kopyadan okunur.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Paketleme betigi bu degeri derleme sirasinda "1" yapar */
export const IS_PACKAGED = process.env.SANALMASA_PAKET === "1";

let sea = null;
if (IS_PACKAGED) {
  // Paketli programda CommonJS calisir; require mevcut
  // eslint-disable-next-line no-undef
  sea = require("node:sea");
}

/** Kaynak klasoru (gelistirmede proje koku) */
export const ROOT = IS_PACKAGED
  ? path.dirname(process.execPath)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Kayit, yukleme ve araclarin duracagi klasor */
export const DATA_ROOT = IS_PACKAGED ? path.join(ROOT, "SanalMasa-Veri") : ROOT;

let keys = null;
function assetKeys() {
  if (!keys) keys = new Set(sea.getAssetKeys());
  return keys;
}

/**
 * Sabit dosyayi okur. base: "public" | "assets", rel: "js/main.js" gibi.
 * Bulunamazsa null.
 */
export function readStatic(base, rel) {
  const clean = path.posix.normalize("/" + rel.replace(/\\/g, "/")).slice(1);
  if (!clean || clean.startsWith("..")) return null;
  if (IS_PACKAGED) {
    const key = `${base}/${clean}`;
    if (!assetKeys().has(key)) return null;
    return Buffer.from(sea.getRawAsset(key));
  }
  const dir = path.join(ROOT, base);
  const file = path.normalize(path.join(dir, clean));
  if (!file.startsWith(dir + path.sep)) return null;
  try {
    const st = fs.statSync(file);
    return st.isFile() ? fs.readFileSync(file) : null;
  } catch {
    return null;
  }
}

/** Bir sabit klasordeki dosya adlari ("assets", "maps" -> ["ballroom.jpeg", ...]) */
export function listStatic(base, sub) {
  if (IS_PACKAGED) {
    const prefix = `${base}/${sub}/`;
    return [...assetKeys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
      .map((k) => k.slice(prefix.length));
  }
  try {
    return fs.readdirSync(path.join(ROOT, base, sub));
  } catch {
    return [];
  }
}
