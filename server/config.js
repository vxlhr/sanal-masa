// Ayarlar: data/ayarlar.json. Ilk calistirmada olusturulur, DM elle duzenleyebilir.
import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";

const WORDS = ["ejder", "kilic", "buyu", "zindan", "kalkan", "okcu", "goblin", "ork", "mesale", "hazine", "kule", "iksir"];

function randomPassword() {
  return WORDS[randomInt(WORDS.length)] + randomInt(100, 1000);
}

const DEFAULT_ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

export function loadConfig(dataDir) {
  const file = path.join(dataDir, "ayarlar.json");
  let cfg = null;
  try {
    cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") console.warn("  [!] ayarlar.json okunamadi:", err.message);
  }
  let created = false;
  if (!cfg || typeof cfg !== "object") {
    // Eski kurulumlarda (masa zaten varsa) bilinen sifreyi koru, yenilerde rastgele uret
    const existing = fs.existsSync(path.join(dataDir, "masa.json"));
    cfg = { dmSifresi: existing ? "dm1234" : randomPassword() };
    created = true;
  }
  cfg.dmSifresi = String(cfg.dmSifresi || randomPassword());
  if (!Array.isArray(cfg.iceServers) || !cfg.iceServers.length) cfg.iceServers = DEFAULT_ICE;
  if (created) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({
        _aciklama: "DM sifresini buradan degistirebilirsin. iceServers: sesli sohbet icin STUN/TURN sunuculari (gelismis).",
        dmSifresi: cfg.dmSifresi,
        iceServers: cfg.iceServers,
      }, null, 2));
    } catch (err) {
      console.warn("  [!] ayarlar.json yazilamadi:", err.message);
    }
  }
  return { ...cfg, file, created };
}
