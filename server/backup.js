// Otomatik yedekler: data/yedekler/ altinda zaman damgali kopyalar.
import fs from "node:fs";
import path from "node:path";

const KEEP = 40;
const EVERY_MS = 10 * 60 * 1000;

export class Backups {
  constructor(dataDir) {
    this.dir = path.join(dataDir, "yedekler");
    this.last = 0;
  }

  stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  }

  /** Kayittan sonra cagrilir; en fazla 10 dakikada bir yedek alir. */
  maybe(data) {
    if (Date.now() - this.last < EVERY_MS) return;
    this.write(data, "otomatik");
  }

  write(data, kind = "elle") {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const name = `masa_${this.stamp()}_${kind}.json`;
      fs.writeFileSync(path.join(this.dir, name), JSON.stringify(data));
      this.last = Date.now();
      this.prune();
      return name;
    } catch (err) {
      console.error("  [!] Yedek alinamadi:", err.message);
      return null;
    }
  }

  prune() {
    const files = this.list();
    for (const f of files.slice(KEEP)) {
      try { fs.unlinkSync(path.join(this.dir, f.name)); } catch { /* yok */ }
    }
  }

  /** En yeniden eskiye */
  list() {
    let names = [];
    try { names = fs.readdirSync(this.dir).filter((n) => /^masa_.*\.json$/.test(n)); } catch { return []; }
    return names
      .map((name) => {
        const st = fs.statSync(path.join(this.dir, name));
        return { name, time: st.mtimeMs, size: st.size, kind: name.includes("_otomatik") ? "otomatik" : name.includes("_once") ? "geri yükleme öncesi" : "elle" };
      })
      .sort((a, b) => b.time - a.time);
  }

  read(name) {
    if (!/^masa_[\w-]+\.json$/.test(name)) throw new Error("Geçersiz yedek adı.");
    return JSON.parse(fs.readFileSync(path.join(this.dir, name), "utf8"));
  }
}
