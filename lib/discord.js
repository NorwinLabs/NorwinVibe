'use strict';
/* Minimal Discord Rich Presence client. Talks to the Discord desktop app over its local IPC pipe (no network, no
   account details). Needs a Discord "application" ID (free, from discord.com/developers); it only names the activity.
   Frame format: int32 opcode, int32 length, then JSON. */
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const encode = (op, data) => { const j = Buffer.from(JSON.stringify(data)); const b = Buffer.alloc(8 + j.length); b.writeInt32LE(op, 0); b.writeInt32LE(j.length, 4); j.copy(b, 8); return b; };
const pipePath = (i) => process.platform === 'win32'
  ? `\\\\?\\pipe\\discord-ipc-${i}`
  : path.join(process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp', `discord-ipc-${i}`);

class DiscordRpc extends EventEmitter {
  /** @param {{clientId: string, pipes?: string[]}} o  `pipes` overrides where to look (used by tests) */
  constructor(o) {
    super(); this.clientId = o.clientId; this.pipes = o.pipes || null;
    this.state = 'idle'; // idle | connecting | connected | no-discord
    this.sock = null; this.buf = Buffer.alloc(0); this.activity = null; this.timer = null; this.enabled = false; this.sentOnce = false;
  }
  _setState(s) { if (this.state !== s) { this.state = s; this.emit('state', s); } }
  start() { this.enabled = true; this._connect(); }
  stop() {
    this.enabled = false; clearTimeout(this.timer);
    try { if (this.state === 'connected' && this.sock) this.sock.write(encode(OP.FRAME, this._frame(null))); } catch {}
    const s = this.sock; this.sock = null; this._setState('idle');
    if (s) setTimeout(() => { try { s.destroy(); } catch {} }, 150); // let the "clear activity" frame leave first
  }
  _frame(activity) { return { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: activity || null }, nonce: crypto.randomUUID() }; }
  /** activity = null clears it */
  setActivity(activity) {
    this.activity = activity;
    if (this.state === 'connected' && this.sock) { try { this.sock.write(encode(OP.FRAME, this._frame(activity))); this.sentOnce = true; } catch {} }
  }
  _retry(ms = 15000) { clearTimeout(this.timer); if (this.enabled) this.timer = setTimeout(() => this._connect(), ms); }
  async _connect() {
    if (!this.enabled || this.state === 'connecting' || this.state === 'connected') return;
    this._setState('connecting');
    const list = this.pipes || Array.from({ length: 10 }, (_, i) => pipePath(i));
    for (const p of list) {
      if (!this.enabled) return;
      try { await this._open(p); return; } catch { /* try the next pipe */ }
    }
    this._setState('no-discord'); this._retry();
  }
  _open(p) {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(p);
      let ready = false;
      const fail = (e) => { try { sock.destroy(); } catch {} reject(e); };
      const to = setTimeout(() => fail(new Error('timeout')), 4000);
      sock.once('error', (e) => { clearTimeout(to); if (!ready) fail(e); });
      sock.once('connect', () => { sock.write(encode(OP.HANDSHAKE, { v: 1, client_id: this.clientId })); });
      sock.on('data', (d) => {
        this.buf = Buffer.concat([this.buf, d]);
        while (this.buf.length >= 8) {
          const op = this.buf.readInt32LE(0), len = this.buf.readInt32LE(4);
          if (this.buf.length < 8 + len) break;
          let msg = null; try { msg = JSON.parse(this.buf.subarray(8, 8 + len).toString()); } catch {}
          this.buf = this.buf.subarray(8 + len);
          if (op === OP.PING) sock.write(encode(OP.PONG, msg || {}));
          else if (op === OP.CLOSE) { sock.destroy(); }
          else if (msg && msg.evt === 'READY' && !ready) {
            ready = true; clearTimeout(to); this.sock = sock; this._setState('connected'); resolve();
            if (this.activity) this.setActivity(this.activity);
          } else if (msg && msg.evt === 'ERROR') this.emit('rpc-error', msg.data);
        }
      });
      sock.once('close', () => {
        clearTimeout(to);
        if (this.sock === sock) { this.sock = null; this.buf = Buffer.alloc(0); this._setState(this.enabled ? 'no-discord' : 'idle'); this._retry(); }
        else if (!ready) reject(new Error('closed'));
      });
    });
  }
}

module.exports = { DiscordRpc, encode, OP };
