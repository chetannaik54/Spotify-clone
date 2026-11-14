import { putFile } from '../../db';
import { TransportError, type DownloadJob, type Transport } from './types';

const MAGIC = (b: Uint8Array) => { const s = String.fromCharCode(...b.slice(0, 4)); return s.startsWith('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) || s === 'fLaC' || s === 'OggS' || s === 'RIFF' || s === 'ftyp' || String.fromCharCode(...b.slice(4, 8)) === 'ftyp'; };

/** Browser transport (dev/testing + web build): fetch with Range-resume, stores the finished file in IndexedDB. */
export class WebTransport implements Transport {
  private partial = new Map<string, Uint8Array[]>();
  constructor(private d: { fetch?: typeof fetch; unmetered?: () => boolean | null } = {}) {}
  supported() { return true; }
  async discard(id: string) { this.partial.delete(id); }
  async freeBytes() { try { const e = await navigator.storage.estimate(); return e.quota != null && e.usage != null ? e.quota - e.usage : null; } catch { return null; } }
  async isUnmetered() { if (this.d.unmetered) return this.d.unmetered(); const c = (navigator as unknown as { connection?: { type?: string; saveData?: boolean } }).connection; return c?.type ? c.type === 'wifi' || c.type === 'ethernet' : null; }

  async download(job: DownloadJob, h: Parameters<Transport['download']>[1]) {
    const f = this.d.fetch ?? fetch; const chunks = this.partial.get(job.id) ?? []; let have = chunks.reduce((n, c) => n + c.length, 0);
    let r: Response;
    try { r = await f(job.url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: h.signal }); }
    catch (e) { throw (h.signal.aborted ? new TransportError('Cancelled', 'cancelled') : new TransportError(`Network error: ${(e as Error).message}`, 'network')); }
    if (r.status === 200 && have) { chunks.length = 0; have = 0; }          // server ignored Range: restart
    else if (!r.ok && r.status !== 206) throw new TransportError(`Server refused the download`, 'http', r.status);
    const len = Number(r.headers.get('Content-Length') ?? 0); const total = (r.status === 206 ? have : 0) + len;
    const reader = r.body?.getReader(); if (!reader) throw new TransportError('No data stream', 'network');
    this.partial.set(job.id, chunks);
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); have += value.length; h.onProgress(have, total); } }
    catch (e) { if (h.signal.aborted) { if (!h.keepPartial()) this.partial.delete(job.id); throw new TransportError('Cancelled', 'cancelled'); } throw new TransportError(`Connection lost: ${(e as Error).message}`, 'network'); }
    if (total && have !== total) throw new TransportError(`Incomplete download (${have}/${total} bytes)`, 'network');
    const all = new Uint8Array(have); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    if (!MAGIC(all)) { this.partial.delete(job.id); throw new TransportError('File is not recognisable audio (bad header)', 'integrity'); }
    this.partial.delete(job.id);
    const id = crypto.randomUUID(); await putFile(id, new Blob([all], { type: 'audio/mpeg' }));
    return { id: `lo-${id}`, url: `local:${id}`, size: have, folder: 'Swarify (browser storage)' };
  }
}
