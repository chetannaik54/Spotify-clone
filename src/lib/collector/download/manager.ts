import type { Catalogue } from '../catalogue';
import { baseTitle, levRatio } from '../match/normalize';
import type { ImportedTrack } from '../types';
import type { Track } from '../../types';
import { TransportError, type DownloadJob, type Settings, type Transport } from './types';

const MB = 1024 * 1024;
export type ManagerDeps = {
  cat: Catalogue; transport: Transport; settings: () => Settings;
  localTracks: () => Track[]; registerLocal: (t: Track) => void;
  now?: () => number; sleep?: (ms: number) => Promise<void>; concurrency?: number; maxAttempts?: number;
};
export type EnqueueResult = { queued: string[]; skipped: { id: string; reason: string }[] };
const MIN_FILE_BYTES = 10_000;       // anything smaller than ~10 KB is an error page, not a song

/** Queue + lifecycle for authorised downloads. Only songs whose chosen recording is verified-permitted can ever be queued. */
export class DownloadManager {
  private listeners = new Set<() => void>(); private running = new Map<string, { ac: AbortController; keep: boolean }>(); private pumping = false;
  private now: () => number; private sleep: (ms: number) => Promise<void>; private conc: number; private maxAttempts: number;
  constructor(private d: ManagerDeps) { this.now = d.now ?? Date.now; this.sleep = d.sleep ?? (ms => new Promise(r => setTimeout(r, ms))); this.conc = d.concurrency ?? 2; this.maxAttempts = d.maxAttempts ?? 3; }
  subscribe(f: () => void) { this.listeners.add(f); return () => this.listeners.delete(f); }
  private emit() { this.listeners.forEach(f => f()); }
  async jobs() { return (await this.d.cat.s.downloads.all()).sort((a, b) => a.created_at - b.created_at); }
  private async put(j: DownloadJob, patch: Partial<DownloadJob> = {}) { const n = { ...j, ...patch, updated_at: this.now() }; await this.d.cat.s.downloads.put(n.id, n); this.emit(); return n; }

  /** Is this imported song downloadable right now? Returns the reason when not. */
  async eligibility(t: ImportedTrack): Promise<{ ok: true; job: Omit<DownloadJob, 'state' | 'bytes' | 'total' | 'attempts' | 'created_at' | 'updated_at'> } | { ok: false; reason: string }> {
    if (t.matching_status === 'downloaded') return { ok: false, reason: 'Already downloaded' };
    const r = await this.d.cat.getMatch(t.id); const c = r?.candidates.find(x => x.key === r.selected);
    if (!r || !c) return { ok: false, reason: 'No confirmed match — confirm a match first' };
    if (c.download.local) return { ok: false, reason: 'Already on this device' };
    if (!c.download.permitted || !c.download.verified || !c.download.url) return { ok: false, reason: `Download not permitted: ${c.download.reason}` };
    if (c.band === 'review' && r.selected_by !== 'user') return { ok: false, reason: 'Match needs your confirmation' };
    const dup = this.d.localTracks().find(l => l.source === 'local' && l.url && levRatio(baseTitle(l.title), baseTitle(t.song_title)) >= 0.95 && (!t.artist_name || !l.artist || levRatio(l.artist.toLowerCase(), t.artist_name.toLowerCase()) >= 0.8));
    if (dup) return { ok: false, reason: 'A copy is already in your library' };
    return { ok: true, job: { id: t.id, candidate_key: c.key, source: c.source, license: c.download.license, url: c.download.url, ext: c.download.format ?? 'mp3', title: t.song_title, artist: t.artist_name || c.artist, album: t.album_name || c.album, art: t.artwork_url || c.artwork_url, duration_ms: t.duration_ms || c.duration_ms, expected_bytes: c.download.bytes } };
  }

  /** Add user-approved songs to the queue. Nothing is ever queued implicitly. */
  async enqueue(trackIds: string[]): Promise<EnqueueResult> {
    const out: EnqueueResult = { queued: [], skipped: [] }; const existing = new Map((await this.jobs()).map(j => [j.id, j]));
    for (const id of trackIds) {
      const t = await this.d.cat.s.tracks.get(id); if (!t) { out.skipped.push({ id, reason: 'Unknown song' }); continue; }
      const ex = existing.get(id); if (ex && ['queued', 'downloading', 'verifying', 'paused', 'waiting_wifi'].includes(ex.state)) { out.skipped.push({ id, reason: 'Already in the queue' }); continue; }
      const e = await this.eligibility(t); if (!e.ok) { out.skipped.push({ id, reason: e.reason }); continue; }
      const cap = await this.storageProblem(e.job.expected_bytes ?? 0); if (cap) { out.skipped.push({ id, reason: cap }); continue; }
      await this.put({ ...e.job, state: 'queued', bytes: 0, total: e.job.expected_bytes ?? 0, attempts: 0, created_at: this.now(), updated_at: this.now() }); out.queued.push(id);
    }
    void this.pump(); return out;
  }

  /** Refuse when the user's storage allowance or the device's free space would be exceeded. */
  async storageProblem(extraBytes: number): Promise<string | null> {
    const used = (await this.jobs()).filter(j => j.state === 'done').reduce((n, j) => n + (j.result?.size ?? 0), 0) + (await this.jobs()).filter(j => ['queued', 'downloading', 'paused', 'waiting_wifi', 'verifying'].includes(j.state)).reduce((n, j) => n + (j.total || 0), 0);
    const max = this.d.settings().maxStorageMB * MB; if (used + extraBytes > max) return `Storage allowance reached (${Math.round(max / MB)} MB) — raise it in the download settings`;
    const free = await this.d.transport.freeBytes().catch(() => null);
    if (free != null && extraBytes && free < extraBytes * 1.1 + 50 * MB) return 'Not enough free space on the device';
    return null;
  }

  async pause(id: string) { const r = this.running.get(id); if (r) { r.keep = true; r.ac.abort(); return; } const j = await this.d.cat.s.downloads.get(id); if (j && ['queued', 'waiting_wifi'].includes(j.state)) await this.put(j, { state: 'paused' }); }
  async resume(id: string) { const j = await this.d.cat.s.downloads.get(id); if (j && ['paused', 'failed', 'waiting_wifi'].includes(j.state)) { await this.put(j, { state: 'queued', error: undefined, attempts: j.state === 'failed' ? 0 : j.attempts }); void this.pump(); } }
  async retry(id: string) { return this.resume(id); }
  async cancel(id: string) {
    const r = this.running.get(id); if (r) { r.keep = false; r.ac.abort(); }
    const j = await this.d.cat.s.downloads.get(id); if (!j) return;
    if (!r) { await this.d.transport.discard(id).catch(() => {}); await this.put(j, { state: 'cancelled' }); await this.d.cat.setStatus(id, 'download_permitted'); }
  }
  async pauseAll() { for (const j of await this.jobs()) if (['queued', 'downloading', 'waiting_wifi'].includes(j.state)) await this.pause(j.id); }
  async resumeAll() { for (const j of await this.jobs()) if (['paused', 'waiting_wifi'].includes(j.state)) await this.resume(j.id); }
  async clearFinished() { for (const j of await this.jobs()) if (['done', 'cancelled'].includes(j.state)) await this.d.cat.s.downloads.del(j.id); this.emit(); }
  /** After an app restart: anything that was mid-flight was approved earlier, so it simply continues. */
  async recover() { for (const j of await this.jobs()) if (['downloading', 'verifying'].includes(j.state)) await this.put(j, { state: 'queued' }); void this.pump(); }

  /** Re-check jobs waiting for Wi-Fi (call periodically and when connectivity changes), then keep the queue moving. */
  async tick() {
    const wifiOnly = this.d.settings().wifiOnly; const unmetered = wifiOnly ? await this.d.transport.isUnmetered().catch(() => null) : true;
    if (unmetered !== false) for (const j of await this.jobs()) if (j.state === 'waiting_wifi') await this.put(j, { state: 'queued' });
    await this.pump();
  }

  private async pump() {
    if (this.pumping) return; this.pumping = true;
    try {
      while (this.running.size < this.conc) {
        const next = (await this.jobs()).find(j => j.state === 'queued' && !this.running.has(j.id)); if (!next) break;
        if (this.d.settings().wifiOnly && (await this.d.transport.isUnmetered().catch(() => null)) === false) { await this.put(next, { state: 'waiting_wifi' }); continue; }
        void this.run(next);
      }
    } finally { this.pumping = false; }
  }

  private async run(job: DownloadJob) {
    const ctl = { ac: new AbortController(), keep: false }; this.running.set(job.id, ctl);
    let j = await this.put(job, { state: 'downloading', error: undefined, attempts: job.attempts + 1 }); await this.d.cat.setStatus(j.id, 'downloading');
    try {
      const res = await this.d.transport.download(j, { signal: ctl.ac.signal, keepPartial: () => ctl.keep, onProgress: (b, t) => { j = { ...j, bytes: b, total: t || j.total }; void this.d.cat.s.downloads.put(j.id, { ...j, updated_at: this.now() }).then(() => this.emit()); } });
      j = await this.put(j, { state: 'verifying', bytes: res.size, total: res.size });
      if (res.size < MIN_FILE_BYTES) { await this.d.transport.discard(j.id).catch(() => {}); throw new TransportError(`Downloaded file is only ${res.size} bytes — not audio`, 'integrity'); }
      if (j.expected_bytes && Math.abs(res.size - j.expected_bytes) > Math.max(2048, j.expected_bytes * 0.01)) { await this.d.transport.discard(j.id).catch(() => {}); throw new TransportError(`Size mismatch: expected ${j.expected_bytes}, got ${res.size}`, 'integrity'); }
      const track: Track = { id: res.id, title: j.title, artist: j.artist || 'Unknown artist', album: j.album, art: j.art, url: res.url, duration: j.duration_ms ? Math.round(j.duration_ms / 1000) : undefined, source: 'local', size: res.size, folder: res.folder ?? 'Music/Swarify' };
      this.d.registerLocal(track); await this.d.cat.markDownloaded(j.id, res.id);
      await this.put(j, { state: 'done', bytes: res.size, total: res.size, result: { id: res.id, url: res.url, size: res.size, folder: res.folder } });
    } catch (e) {
      const te = e instanceof TransportError ? e : new TransportError((e as Error).message, 'network');
      if (te.kind === 'cancelled') {
        await this.put(j, { state: ctl.keep ? 'paused' : 'cancelled' }); await this.d.cat.setStatus(j.id, 'download_permitted');   // back to "permitted, not downloaded"
      } else if (te.kind === 'wifi') { await this.put(j, { state: 'waiting_wifi', attempts: Math.max(0, j.attempts - 1) }); await this.d.cat.setStatus(j.id, 'download_permitted'); }
      else if (te.kind === 'storage') { await this.put(j, { state: 'failed', error: te.message }); await this.d.cat.setStatus(j.id, 'download_permitted'); }
      else {
        const transient = te.kind === 'network' || (te.kind === 'http' && (te.status ?? 500) >= 500 || te.status === 429);
        if (transient && j.attempts < this.maxAttempts) { await this.put(j, { state: 'queued', error: `${te.message} — retrying (${j.attempts}/${this.maxAttempts})` }); await this.sleep(Math.min(30_000, 1000 * 2 ** j.attempts)); }
        else { await this.put(j, { state: 'failed', error: te.status ? `${te.message} (HTTP ${te.status})` : te.message }); await this.d.cat.setStatus(j.id, 'failed'); }
      }
    } finally { this.running.delete(j.id); void this.pump(); }
  }
}
