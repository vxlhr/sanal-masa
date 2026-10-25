// Sunucu kurallari testi: yetkiler, gizli token filtreleme, sis, savas, yeniden baglanma.
// Kullanim: once ayri bir pencerede  node server/index.js --port=8099 --nobrowser --data=test/veri
//           sonra                     node test/sunucu-testi.mjs
// --data=test/veri sayesinde gercek masa kaydina (data/masa.json) dokunulmaz.
import WebSocket from "ws";
import fs from "node:fs";
const URL = `ws://localhost:${process.env.PORT || 8099}/ws`;
function client(join) {
  return new Promise((res) => {
    const ws = new WebSocket(URL);
    const c = { ws, state: null, msgs: [], errors: [] };
    c.send = (m) => ws.send(JSON.stringify(m));
    c.wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      c.msgs.push(m);
      if (m.t === "welcome" || m.t === "state") c.state = m.state;
      if (m.t === "error") c.errors.push(m.message);
      if (m.t === "welcome") res(c);
      if (m.t === "error" && m.fatal) res(c);
    });
    ws.on("open", () => c.send(join));
  });
}
let fails = 0;
const ok = (cond, label) => { console.log((cond ? "  OK  " : "  FAIL") + " " + label); if (!cond) fails++; };

const bad = await client({ t: "join", name: "X", asDm: true, password: "yanlis" });
ok(bad.errors.includes("DM şifresi yanlış."), "wrong DM password rejected");
bad.ws.close();

const dm = await client({ t: "join", name: "Usta", asDm: true, password: process.env.DM_PASSWORD || JSON.parse(fs.readFileSync((process.env.DATA || "test/veri") + "/ayarlar.json", "utf8")).dmSifresi });
const pl = await client({ t: "join", name: "Ayla", color: "#4f9be0" });
ok(!pl.state.you.isDm && pl.state.scenes.length === 0, "player has no scene list");
ok(dm.state.scenes.length >= 4, "dm sees scene list");

// player creates own token
pl.send({ t: "token.create", name: "Ayla", x: 300, y: 300, maxHp: 20, hidden: true, kind: "monster" });
await pl.wait();
const mine = pl.state.scene.tokens.find((t) => t.name === "Ayla");
ok(mine && mine.ownerId === pl.state.you.id && mine.kind === "pc" && !mine.hidden, "player token forced to own pc, not hidden");

// DM token
dm.send({ t: "token.create", name: "Goblin", x: 500, y: 500, maxHp: 7, kind: "monster", hidden: true });
await dm.wait();
const gob = dm.state.scene.tokens.find((t) => t.name === "Goblin");
ok(gob && gob.hidden, "dm hidden goblin created");
ok(!pl.state.scene.tokens.some((t) => t.id === gob.id), "player does NOT receive hidden goblin");
ok(!JSON.stringify(pl.msgs.filter((m) => m.t !== "welcome")).includes("Goblin"), "goblin name never sent to player");

dm.send({ t: "token.update", id: gob.id, fields: { hidden: false } });
await dm.wait();
const pg = pl.state.scene.tokens.find((t) => t.id === gob.id);
ok(pg && pg.hp === undefined && pg.hpState === "healthy", "revealed goblin visible, HP masked");

// player tries to move goblin
pl.errors.length = 0;
pl.send({ t: "token.move", id: gob.id, x: 0, y: 0 });
await pl.wait();
ok(pl.errors.length === 1, "player cannot move DM token: " + pl.errors[0]);

pl.send({ t: "token.move", id: mine.id, x: 433, y: 433 });
await pl.wait();
const moved = pl.state.scene.tokens.find((t) => t.id === mine.id);
ok(moved.x % 70 === 0 && moved.y % 70 === 0, "move snaps to grid: " + moved.x + "," + moved.y);

// fog hides goblin
dm.send({ t: "fog.reset", mode: "hide" });
await dm.wait();
ok(!pl.state.scene.tokens.some((t) => t.id === gob.id), "fogged goblin hidden from player");
ok(pl.state.scene.tokens.some((t) => t.id === mine.id), "own token still visible in fog");
dm.send({ t: "fog.op", type: "reveal", x: 400, y: 400, w: 300, h: 300 });
await dm.wait();
ok(pl.state.scene.tokens.some((t) => t.id === gob.id), "revealed area shows goblin");
dm.send({ t: "fog.toggle", enabled: false });

// player cannot do DM stuff
pl.errors.length = 0;
pl.send({ t: "scene.activate", id: dm.state.scenes[1].id });
pl.send({ t: "fog.reset", mode: "reveal" });
pl.send({ t: "player.kick", id: dm.state.you.id });
await pl.wait();
ok(pl.errors.length === 3, "player blocked from DM actions (" + pl.errors.length + ")");

// whisper
pl.send({ t: "chat.send", text: "/dm gizli plan" });
dm.send({ t: "roll", expr: "1d20", whisper: true, label: "gizli zar" });
const third = await client({ t: "join", name: "Baran" });
await pl.wait();
ok(dm.msgs.some((m) => m.t === "chat" && m.msg.text === "gizli plan"), "dm receives whisper");
ok(!third.msgs.some((m) => JSON.stringify(m).includes("gizli plan")), "other player does not see whisper");
ok(!third.msgs.some((m) => JSON.stringify(m).includes("gizli zar")), "other player does not see DM secret roll");

// combat
dm.send({ t: "combat.add", ids: [gob.id, mine.id] });
dm.send({ t: "combat.roll" });
dm.send({ t: "combat.start" });
await dm.wait();
const c = dm.state.scene.combat;
ok(c.active && c.entries.length === 2 && c.entries.every((e) => typeof e.init === "number"), "combat started with inits");
ok(c.entries[0].init >= c.entries[1].init, "sorted by initiative");
const curId = c.currentTokenId;
const actor = curId === mine.id ? pl : dm;
actor.send({ t: "combat.next" });
await dm.wait();
ok(dm.state.scene.combat.currentTokenId !== curId, "turn advanced by current actor");
dm.send({ t: "combat.end" });

// damage
pl.send({ t: "token.damage", id: mine.id, amount: 5 });
await pl.wait();
ok(pl.state.scene.tokens.find((t) => t.id === mine.id).hp === 15, "damage applied");
pl.send({ t: "token.damage", id: mine.id, amount: -100 });
await pl.wait();
ok(pl.state.scene.tokens.find((t) => t.id === mine.id).hp === 20, "heal capped at max");

// reconnect with secret
const secret = pl.msgs.find((m) => m.t === "welcome").secret;
pl.ws.close();
const pl2 = await client({ t: "join", secret });
ok(pl2.state && pl2.state.you.name === "Ayla", "resume with secret works");

// same name takeover while online is refused
const dup = await client({ t: "join", name: "ayla" });
ok(dup.errors.some((e) => e.includes("zaten")), "duplicate online name refused");

// cleanup
dm.send({ t: "token.delete", id: gob.id });
pl2.send({ t: "token.delete", id: mine.id });
dm.send({ t: "player.kick", id: third.state.you.id });
await dm.wait(300);
ok(third.msgs.some((m) => m.t === "kicked"), "kicked player notified");
for (const x of [dm, pl2, dup, third]) x.ws.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
