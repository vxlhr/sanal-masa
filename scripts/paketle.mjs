// Tek dosyalik program uretir (Node "single executable application").
// Kullanim: node scripts/paketle.mjs
// Cikti: dist/SanalMasa-Windows.exe  |  dist/SanalMasa-Mac-<arch>.tar.gz  |  dist/SanalMasa-Linux-<arch>.tar.gz
// Programi hangi isletim sisteminde calistirirsan o sisteme ait cikti uretilir (GitHub Actions uc sistemde calistirir).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "build");
const DIST = path.join(ROOT, "dist");
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

const platform = { win32: "Windows", darwin: "Mac", linux: "Linux" }[process.platform];
if (!platform) throw new Error("Desteklenmeyen sistem: " + process.platform);
const arch = process.arch;
const exeName = process.platform === "win32" ? "SanalMasa.exe" : "SanalMasa";

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT });

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

// 1) Sunucuyu tek CommonJS dosyasinda topla
console.log("1/4 Sunucu paketleniyor...");
await build({
  entryPoints: [path.join(ROOT, "server", "index.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: path.join(BUILD, "sunucu.cjs"),
  define: { "process.env.SANALMASA_PAKET": '"1"' },
  external: ["bufferutil", "utf-8-validate"], // ws'nin istege bagli hizlandiricilari
  logLevel: "warning",
  logOverride: { "empty-import-meta": "silent" },
});

// 2) Arayuz ve hazir gorselleri programin icine gom
console.log("2/4 Dosyalar gomuluyor...");
const assets = {};
function walk(base, dir = "") {
  for (const e of fs.readdirSync(path.join(ROOT, base, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) walk(base, rel);
    else if (!e.name.startsWith(".")) assets[`${base}/${rel}`] = path.join(ROOT, base, rel);
  }
}
walk("public");
walk("assets");
const seaConfig = {
  main: path.join(BUILD, "sunucu.cjs"),
  output: path.join(BUILD, "sea.blob"),
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  assets,
};
fs.writeFileSync(path.join(BUILD, "sea-config.json"), JSON.stringify(seaConfig, null, 2));
run(process.execPath, ["--experimental-sea-config", path.join(BUILD, "sea-config.json")]);

// 3) Node programinin kopyasina enjekte et
console.log("3/4 Program olusturuluyor...");
fs.mkdirSync(path.join(BUILD, "program"), { recursive: true });
const exe = path.join(BUILD, "program", exeName);
fs.copyFileSync(process.execPath, exe);
if (process.platform === "darwin") run("codesign", ["--remove-signature", exe]);
if (process.platform === "win32") removeWindowsSignature(exe);
const postject = path.join(ROOT, "node_modules", "postject", "dist", "cli.js");
const injectArgs = [postject, exe, "NODE_SEA_BLOB", seaConfig.output, "--sentinel-fuse", FUSE];
if (process.platform === "darwin") injectArgs.push("--macho-segment-name", "NODE_SEA");
run(process.execPath, injectArgs);
if (process.platform === "darwin") run("codesign", ["--sign", "-", exe]);
if (process.platform !== "win32") fs.chmodSync(exe, 0o755);

// 4) Dagitima hazirla
console.log("4/4 Dagitim dosyasi hazirlaniyor...");
let out;
if (process.platform === "win32") {
  // Windows: dogrudan .exe (ZIP'ten cikarma derdi yok)
  out = path.join(DIST, `SanalMasa-${platform}.exe`);
  fs.copyFileSync(exe, out);
} else {
  // Mac / Linux: calistirma izni korunsun diye tar.gz
  const stage = path.join(BUILD, "paket");
  const folder = path.join(stage, "SanalMasa");
  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(exe, path.join(folder, exeName));
  fs.chmodSync(path.join(folder, exeName), 0o755);
  out = path.join(DIST, `SanalMasa-${platform}-${arch}.tar.gz`);
  run("tar", ["-czf", out, "-C", stage, "SanalMasa"]);
}
const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`\nHazir: ${path.relative(ROOT, out)} (${mb} MB)`);

/**
 * Node'un dijital imzasi icerik degisince bozulur; bozuk imza bazi antiviruslerde imzasizdan
 * daha supheli gorunur. Windows SDK'daki signtool varsa (GitHub sunucularinda var) imzayi kaldir.
 */
function removeWindowsSignature(file) {
  const kits = "C:/Program Files (x86)/Windows Kits/10/bin";
  let tool = null;
  try {
    const versions = fs.readdirSync(kits).filter((v) => /^10\./.test(v)).sort().reverse();
    for (const v of versions) {
      const candidate = path.join(kits, v, "x64", "signtool.exe");
      if (fs.existsSync(candidate)) { tool = candidate; break; }
    }
  } catch { /* SDK yok */ }
  if (!tool) { console.log("   (signtool bulunamadi, imza kaldirilmadi; program yine de calisir)"); return; }
  try { run(tool, ["remove", "/s", file]); } catch { console.log("   (imza kaldirilamadi, devam ediliyor)"); }
}
