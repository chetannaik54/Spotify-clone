// Minimal Chrome DevTools Protocol client for an Android WebView page (Playwright cannot attach to WebView).
const WebSocket = require('ws');
class Ui {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.on('message', m => { const d = JSON.parse(m);
      if (d.id && this.pending.has(d.id)) { const { res, rej } = this.pending.get(d.id); this.pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); }
      else if (d.method === 'Runtime.exceptionThrown') this.errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); }); }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed'); return r.result.value; }
  // element helpers (selector + optional text filter)
  find = (sel, text) => `(Array.from(document.querySelectorAll(${JSON.stringify(sel)})).filter(e => !${JSON.stringify(text ?? '')} || e.textContent.includes(${JSON.stringify(text ?? '')})))`;
  count(sel, text) { return this.eval(`${this.find(sel, text)}.length`); }
  text(sel, text) { return this.eval(`(${this.find(sel, text)}[0] || {}).textContent || ''`); }
  texts(sel, text) { return this.eval(`${this.find(sel, text)}.map(e => e.textContent)`); }
  async click(sel, text) { const ok = await this.eval(`(() => { const e = ${this.find(sel, text)}[0]; if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true; })()`); if (!ok) throw new Error(`click: no element ${sel} ${text ?? ''}`); }
  async waitFor(sel, text, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { if (await this.count(sel, text)) return true; await new Promise(r => setTimeout(r, 400)); } return false; }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}
async function connectPage(port = 9222) {
  let list = [];
  for (let i = 0; i < 40 && !list.some(t => t.type === 'page'); i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { /* retry */ } await new Promise(r => setTimeout(r, 500)); }
  const t = list.find(t => t.type === 'page'); if (!t) throw new Error('no WebView page target');
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const ui = new Ui(ws); await ui.send('Runtime.enable'); return ui;
}
module.exports = { connectPage };
