// Ek ozellik testi: duvar/gorus filtrelemesi, sablonlar, saldiri, buyu yuvalari, geri yukleme,
// yedekler, oturum ozeti, sesli sohbet sinyallesmesi.
// Kullanim: node server/index.js --port=8099 --nobrowser --data=test/veri   sonra   node test/ek-ozellik-testi.mjs
import WebSocket from "ws";
import fs from "node:fs";

const PORT = process.env.PORT || 8099;
const URL = `ws://localhost:${PORT}/ws`;
const DATA = process.env.DATA || "test/veri";
const DM_PASS = process.env.DM_PASSWORD || JSON.parse(fs.readFileSync(`${DATA}/ayarlar.json`, "utf8")).dmSifresi;

function client(join) {
  return new Promise((res) => {
    const ws = new WebSocket(URL);
    const c = { ws, state: null, msgs: [], errors: [] };
    c.send = (m) => ws.send(JSON.stringify(m));
    c.wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
    c.last = (t) => [...c.msgs].reverse().find((m) => m.t === t);
    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      c.msgs.push(m);
      if (m.t === "welcome" || m.t === "state") c.state = m.state;
      if (m.t === "welcome") c.cid = m.cid;
      if (m.t === "error") c.errors.push(m.message);
      if (m.t === "welcome" || (m.t === "error" && m.fatal)) res(c);
    });
    ws.on("open", () => c.send(join));
  });
}

let fails = 0;
const ok = (cond, label) => { console.log((cond ? "  OK  " : "  FAIL") + " " + label); if (!cond) fails++; };

const dm = await client({ t: "join", name: "Usta", asDm: true, password: DM_PASS });
ok(dm.state && dm.state.you.isDm, "DM joins with password from ayarlar.json");
const pl = await client({ t: "join", name: "Kaya" });

// Temiz sahne
dm.send({ t: "scene.create", name: "Test Zindani" });
await dm.wait();
const gs = dm.state.scene.grid.size;

// Oyuncu tokeni (0,0 civari) ve duvarin arkasinda goblin
pl.send({ t: "token.create", name: "Kaya", x: gs / 2, y: gs / 2 });
dm.send({ t: "token.create", name: "Goblin", kind: "monster", x: gs * 6.5, y: gs / 2, maxHp: 7 });
await dm.wait();
const gob = dm.state.scene.tokens.find((t) => t.name === "Goblin");
const kaya = dm.state.scene.tokens.find((t) => t.name === "Kaya");
ok(pl.state.scene.tokens.some((t) => t.id === gob.id), "without vision, player sees goblin");

dm.send({ t: "vision.set", enabled: true });
dm.send({ t: "wall.add", segments: [[gs * 3, -gs * 5, gs * 3, gs * 5]] });
await dm.wait();
ok(!pl.state.scene.tokens.some((t) => t.id === gob.id), "wall blocks line of sight: goblin hidden from player");
ok(dm.state.scene.tokens.some((t) => t.id === gob.id), "DM still sees goblin");
ok(pl.state.scene.walls.length === 1, "walls sent to player for rendering");

const wallId = dm.state.scene.walls[0].id;
dm.send({ t: "wall.delete", id: wallId });
dm.send({ t: "wall.add", segments: [[gs * 3, -gs * 5, gs * 3, gs * 5]], door: true });
await dm.wait();
const door = dm.state.scene.walls[0];
ok(door.door && !pl.state.scene.tokens.some((t) => t.id === gob.id), "closed door blocks sight");
pl.errors.length = 0;
pl.send({ t: "door.toggle", id: door.id });
await pl.wait();
ok(pl.errors.length === 1, "player too far from door cannot open it");
dm.send({ t: "door.toggle", id: door.id });
await dm.wait();
ok(pl.state.scene.tokens.some((t) => t.id === gob.id), "opened door: goblin visible");
dm.send({ t: "door.toggle", id: door.id });

// Karanlik: isik ve karanlik gorus
dm.send({ t: "wall.clear" });
dm.send({ t: "vision.set", dark: true });
await dm.wait();
ok(!pl.state.scene.tokens.some((t) => t.id === gob.id), "dark scene: goblin unseen without light");
pl.send({ t: "token.update", id: kaya.id, fields: { darkvision: 60 } });
await pl.wait();
ok(pl.state.scene.tokens.some((t) => t.id === gob.id), "darkvision 60ft reveals goblin 6 squares away");
pl.send({ t: "token.update", id: kaya.id, fields: { darkvision: 0 } });
dm.send({ t: "token.update", id: gob.id, fields: { light: 20 } });
await dm.wait();
ok(pl.state.scene.tokens.some((t) => t.id === gob.id), "goblin holding a torch is visible in the dark");
ok(pl.state.scene.lights.length === 1, "light sources sent");
dm.send({ t: "vision.set", enabled: false, dark: false });

// Sablon
pl.send({ t: "template.add", shape: "circle", x: 100, y: 100, size: 20, ref: "r1" });
await pl.wait();
const created = pl.last("created");
ok(created && created.kind === "template" && created.ref === "r1", "template created, id returned for undo");
pl.send({ t: "template.update", id: created.id, x: 400, y: 300, color: "#59b86b", size: 30 });
await pl.wait();
const moved = pl.state.scene.templates.find((t) => t.id === created.id);
ok(moved.x === 400 && moved.y === 300 && moved.color === "#59b86b" && moved.size === 30, "template moved, recolored, resized");
const third = await client({ t: "join", name: "Deniz" });
third.errors.length = 0;
third.send({ t: "template.update", id: created.id, x: 0 });
await third.wait();
ok(third.errors.length === 1, "others cannot edit someone else's template");
third.ws.close();
dm.errors.length = 0;
pl.send({ t: "template.delete", id: created.id });
await pl.wait();
ok(pl.state.scene.templates.length === 0, "owner deletes template");

// Saldiri ve buyu
pl.send({ t: "token.update", id: kaya.id, fields: { sheet: { dex: 14, attacks: [{ name: "Kılıç", bonus: 5, damage: "1d8+3" }], slots: [[2, 0]], spells: [{ name: "Büyülü Füze", level: 1 }] } } });
await pl.wait();
pl.send({ t: "attack", id: kaya.id, index: 0 });
await pl.wait(400);
const rolls = pl.msgs.filter((m) => m.t === "chat" && m.msg.type === "roll").map((m) => m.msg);
const atk = rolls.find((r) => r.label.includes("saldırı"));
ok(atk && atk.roll.expr === "1d20+5", "attack roll 1d20+5");
const nat = atk.roll.parts[0].rolls[0].v;
const dmg = rolls.find((r) => r.label.includes("hasar"));
ok(nat === 1 ? !dmg : dmg && (nat === 20 ? dmg.roll.expr === "2d8+3" : dmg.roll.expr === "1d8+3"), `damage roll follows attack (nat ${nat})`);
pl.send({ t: "spell.cast", id: kaya.id, level: 1, name: "Büyülü Füze" });
pl.send({ t: "spell.cast", id: kaya.id, level: 1, name: "Büyülü Füze" });
pl.errors.length = 0;
pl.send({ t: "spell.cast", id: kaya.id, level: 1, name: "Büyülü Füze" });
await pl.wait();
ok(pl.errors.some((e) => e.includes("yuvan kalmadı")), "third cast fails: no slots left");
pl.send({ t: "rest.long", id: kaya.id });
await pl.wait();
ok(pl.state.scene.tokens.find((t) => t.id === kaya.id).sheet.slots[0][1] === 0, "long rest restores slots");

// Hasar, olum ve oturum
dm.send({ t: "token.damage", id: gob.id, amount: 10 });
await dm.wait();
ok(dm.msgs.some((m) => m.t === "chat" && m.msg.text && m.msg.text.includes("Goblin öldü")), "kill announced");
dm.send({ t: "session.summary", post: true });
await dm.wait();
const ses = dm.last("session");
ok(ses && ses.session.kills.includes("Goblin") && ses.session.damage >= 7, "session summary tracks kill and damage");

// Geri alma: sil ve geri yukle
const snapshot = dm.state.scene.tokens.find((t) => t.id === gob.id);
dm.send({ t: "token.delete", id: gob.id });
await dm.wait();
dm.send({ t: "token.restore", token: snapshot });
await dm.wait();
ok(dm.state.scene.tokens.some((t) => t.id === gob.id), "deleted token restored with same id");
pl.errors.length = 0;
pl.send({ t: "token.restore", token: { ...snapshot, id: "tk_fake", ownerId: dm.state.you.id } });
await pl.wait();
ok(pl.errors.length === 1, "player cannot restore someone else's token");

// Yedekler
dm.send({ t: "backup.now" });
await dm.wait(400);
const bl = dm.last("backups");
ok(bl && bl.made && bl.list.length >= 1, "manual backup created");
dm.send({ t: "scene.update", id: dm.state.scene.id, name: "DEGISTI" });
await dm.wait();
dm.send({ t: "backup.restore", name: bl.made });
await dm.wait(500);
ok(dm.state.scene.name === "Test Zindani", "restore brings back old scene name");
ok(dm.state.you.isDm && pl.state.you.name === "Kaya", "sessions survive restore");
pl.send({ t: "backup.list" });
await pl.wait();
ok(pl.errors.some((e) => e.includes("DM")), "player cannot list backups");

// Sesli sohbet sinyallesmesi
dm.send({ t: "voice.join" });
pl.send({ t: "voice.join" });
await pl.wait();
const roster = pl.last("voice.roster");
ok(roster && roster.members.length === 2, "voice roster has 2 members");
pl.send({ t: "voice.signal", to: dm.cid, data: { sdp: "test" } });
await dm.wait();
const sig = dm.last("voice.signal");
ok(sig && sig.from === pl.cid && sig.data.sdp === "test", "signal relayed to target");
pl.ws.close();
await dm.wait(300);
ok(dm.last("voice.roster").members.length === 1, "roster updates when someone disconnects");

// Muzik
dm.send({ t: "music.play", kind: "ambient", track: "rain" });
await dm.wait();
ok(dm.state.music && dm.state.music.track === "rain", "ambient music state");
dm.send({ t: "music.stop" });

// Disa aktarma: oturum anahtarlari icermemeli
const secret = dm.msgs.find((m) => m.t === "welcome").secret;
const exp = await (await fetch(`http://localhost:${PORT}/api/export`, { headers: { "X-Session": secret } })).text();
ok(exp.includes("scenes") && !exp.includes(secret), "export works and contains no session secrets");
const noAuth = await fetch(`http://localhost:${PORT}/api/export`);
ok(noAuth.status === 403, "export requires DM");

dm.send({ t: "scene.delete", id: dm.state.scene.id });
await dm.wait();
dm.ws.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
