// WebSocket baglantisi: kopunca kendiliginden yeniden baglanir ve oturuma geri doner.
export class Net {
  constructor({ onMessage, onStatus, onFatal }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.onFatal = onFatal;
    this.ws = null;
    this.joinMsg = null;
    this.retry = 0;
    this.stopped = false;
    this.queue = [];
  }

  start(joinMsg) {
    this.joinMsg = joinMsg;
    this.stopped = false;
    this.open();
  }

  /** Giris basarili olduktan sonra yeniden baglanmalarda kullanilacak bilgi */
  setResume(secret) {
    this.joinMsg = { t: "join", secret };
  }

  open() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify(this.joinMsg));
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === "welcome") {
        this.onStatus(true);
        const q = this.queue;
        this.queue = [];
        q.forEach((m) => this.send(m));
      }
      if (msg.t === "kicked") { this.stop(); this.onFatal(msg.reason); return; }
      if (msg.t === "error" && msg.fatal) { this.stop(); this.onFatal(msg.message, true); return; }
      this.onMessage(msg);
    };

    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.onStatus(false);
      if (this.stopped || e.code === 4001) return;
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => { if (!this.stopped) this.open(); }, delay);
    };
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (!["token.drag", "measure", "ping"].includes(msg.t)) this.queue.push(msg);
  }

  stop() {
    this.stopped = true;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try { ws.close(); } catch { /* yok */ }
    }
  }
}
