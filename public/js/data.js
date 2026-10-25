// D&D 5e sabit verileri (Turkce adlarla)

export const ABILITIES = [
  { key: "str", name: "Güç", short: "GÜÇ" },
  { key: "dex", name: "Çeviklik", short: "ÇEV" },
  { key: "con", name: "Dayanıklılık", short: "DAY" },
  { key: "int", name: "Zekâ", short: "ZEK" },
  { key: "wis", name: "Bilgelik", short: "BİL" },
  { key: "cha", name: "Karizma", short: "KAR" },
];

export const SKILLS = [
  { key: "acrobatics", name: "Akrobasi", ab: "dex" },
  { key: "animal", name: "Hayvan Terbiyesi", ab: "wis" },
  { key: "arcana", name: "Gizemli Bilgi", ab: "int" },
  { key: "athletics", name: "Atletizm", ab: "str" },
  { key: "deception", name: "Aldatma", ab: "cha" },
  { key: "history", name: "Tarih", ab: "int" },
  { key: "insight", name: "Sezgi", ab: "wis" },
  { key: "intimidation", name: "Gözdağı", ab: "cha" },
  { key: "investigation", name: "Araştırma", ab: "int" },
  { key: "medicine", name: "Tıp", ab: "wis" },
  { key: "nature", name: "Doğa", ab: "int" },
  { key: "perception", name: "Algı", ab: "wis" },
  { key: "performance", name: "Performans", ab: "cha" },
  { key: "persuasion", name: "İkna", ab: "cha" },
  { key: "religion", name: "Din", ab: "int" },
  { key: "sleight", name: "El Çabukluğu", ab: "dex" },
  { key: "stealth", name: "Gizlilik", ab: "dex" },
  { key: "survival", name: "Hayatta Kalma", ab: "wis" },
];

export const mod = (score) => Math.floor(((Number(score) || 10) - 10) / 2);
export const fmtMod = (n) => (n >= 0 ? "+" : "−") + Math.abs(n);
export const profForLevel = (level) => 2 + Math.floor((Math.max(1, level) - 1) / 4);

export function defaultSheet() {
  return { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, prof: 2, level: 1, speed: 30, race: "", cls: "", saves: [], skills: [], expertise: [] };
}

// Hazir yaratiklar (5e SRD degerleri). size: kare cinsinden
export const MONSTERS = [
  { name: "Goblin", hp: 7, ac: 15, init: 2, size: 1, cr: "1/4" },
  { name: "Kobold", hp: 5, ac: 12, init: 2, size: 1, cr: "1/8" },
  { name: "Haydut", hp: 11, ac: 12, init: 1, size: 1, cr: "1/8" },
  { name: "Kültist", hp: 9, ac: 12, init: 1, size: 1, cr: "1/8" },
  { name: "Muhafız", hp: 11, ac: 16, init: 1, size: 1, cr: "1/8" },
  { name: "İskelet", hp: 13, ac: 13, init: 2, size: 1, cr: "1/4" },
  { name: "Zombi", hp: 22, ac: 8, init: -2, size: 1, cr: "1/4" },
  { name: "Kurt", hp: 11, ac: 13, init: 2, size: 1, cr: "1/4" },
  { name: "Ork", hp: 15, ac: 13, init: 1, size: 1, cr: "1/2" },
  { name: "Hobgoblin", hp: 11, ac: 18, init: 1, size: 1, cr: "1/2" },
  { name: "Gnoll", hp: 22, ac: 15, init: 1, size: 1, cr: "1/2" },
  { name: "Gulyabani", hp: 22, ac: 12, init: 2, size: 1, cr: "1" },
  { name: "Bugbear", hp: 27, ac: 16, init: 2, size: 1, cr: "1" },
  { name: "Dev Örümcek", hp: 26, ac: 14, init: 3, size: 2, cr: "1" },
  { name: "Vahşi Kurt", hp: 37, ac: 14, init: 2, size: 2, cr: "1" },
  { name: "Haydut Lideri", hp: 65, ac: 15, init: 3, size: 1, cr: "2" },
  { name: "Ogre", hp: 59, ac: 11, init: -1, size: 2, cr: "2" },
  { name: "Mimik", hp: 58, ac: 12, init: 1, size: 1, cr: "2" },
  { name: "Baykuşayı", hp: 59, ac: 13, init: 1, size: 2, cr: "3" },
  { name: "Minotor", hp: 76, ac: 14, init: 0, size: 2, cr: "3" },
  { name: "Hayalet", hp: 45, ac: 11, init: 1, size: 1, cr: "4" },
  { name: "Trol", hp: 84, ac: 15, init: 1, size: 2, cr: "5" },
  { name: "Genç Kırmızı Ejderha", hp: 178, ac: 18, init: 0, size: 2, cr: "10" },
  { name: "Lich", hp: 135, ac: 17, init: 3, size: 1, cr: "21" },
  { name: "Göz Tiranı (Beholder)", hp: 180, ac: 18, init: 2, size: 2, cr: "13" },
  { name: "Yetişkin Kırmızı Ejderha", hp: 256, ac: 19, init: 0, size: 3, cr: "17" },
];

export const REACTIONS = ["😂", "😱", "🔥", "👍", "💀", "🎲", "❤️", "🤔"];
