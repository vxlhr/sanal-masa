// Hesapsiz Cloudflare "quick tunnel": masayi internete acar ve https adresini yakalar.
// cloudflared yoksa isletim sistemine uygun surumu GitHub'dan indirir (tek seferlik).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawn, execFileSync } from "node:child_process";

const BASE = "https://github.com/cloudflare/cloudflared/releases/latest/download/";

function assetName() {
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "arm" ? "arm" : process.arch === "ia32" ? "386" : "amd64";
  if (process.platform === "win32") return { file: `cloudflared-windows-${arch === "arm64" ? "amd64" : arch}.exe`, tgz: false };
  if (process.platform === "darwin") return { file: `cloudflared-darwin-${arch === "arm64" ? "arm64" : "amd64"}.tgz`, tgz: true };
  return { file: `cloudflared-linux-${arch}`, tgz: false };
}

function onPath() {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", ["cloudflared"], { stdio: "ignore" });
    return "cloudflared";
  } catch {
    return null;
  }
}

/** Basit tar okuyucu: arsivdeki ilk normal dosyayi dondurur. */
function firstFileFromTar(buf) {
  let off = 0;
  while (off + 512 <= buf.length) {
    const name = buf.toString("utf8", off, off + 100).replace(/\0.*$/s, "");
    if (!name) break;
    const size = parseInt(buf.toString("utf8", off + 124, off + 136).replace(/\0.*$/s, "").trim() || "0", 8);
    const type = buf[off + 156];
    if (type === 0 || type === 48) return buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("Arsivde dosya bulunamadi");
}

async function ensureBinary(toolsDir, log) {
  const system = onPath();
  if (system) return system;
  const exe = path.join(toolsDir, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  if (fs.existsSync(exe)) return exe;

  const { file, tgz } = assetName();
  log(`  cloudflared indiriliyor (tek seferlik, ~40 MB): ${file}`);
  const res = await fetch(BASE + file, { redirect: "follow" });
  if (!res.ok) throw new Error(`indirme basarisiz (HTTP ${res.status})`);
  let data = Buffer.from(await res.arrayBuffer());
  if (tgz) data = firstFileFromTar(zlib.gunzipSync(data));
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(exe, data);
  if (process.platform !== "win32") fs.chmodSync(exe, 0o755);
  return exe;
}

/**
 * Tuneli baslatir. onUrl(url) adres bulununca cagrilir. Tunel kapanirsa birkac kez yeniden dener.
 */
export async function startTunnel({ port, toolsDir, onUrl, log = console.log }) {
  let bin;
  try {
    bin = await ensureBinary(toolsDir, log);
  } catch (err) {
    log(`  [!] Internete acilamadi: cloudflared hazirlanamadi (${err.message}).`);
    log("      Internet baglantini kontrol et ya da sadece ayni evde oyna.");
    return;
  }

  let attempts = 0;
  const run = () => {
    attempts++;
    const child = spawn(bin, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
    let found = false;
    const scan = (chunk) => {
      const m = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !found) {
        found = true;
        attempts = 0;
        onUrl(m[0]);
      }
    };
    child.stdout.on("data", scan);
    child.stderr.on("data", scan);
    child.on("exit", () => {
      onUrl(null);
      if (attempts < 5) {
        log("  [!] Internet tuneli kapandi, yeniden aciliyor...");
        setTimeout(run, 3000 * attempts);
      } else {
        log("  [!] Internet tuneli acilamiyor. Masa sadece bu bilgisayarda/evde calisiyor.");
      }
    });
    process.on("exit", () => { try { child.kill(); } catch { /* yok */ } });
  };
  run();
}
