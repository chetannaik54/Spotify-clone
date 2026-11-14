import type { Track } from '../types';
import { lyricsKey } from '../lyricsCache';
import { selectionSig } from './inventory';
import type { JourneyPlan } from './types';
import type { VerifyRaw } from '../scan';

export type FileStatus = 'ok' | 'missing' | 'corrupt' | 'unverifiable' | 'network';
export type FileCheck = { id: string; title: string; status: FileStatus; detail: string };
export type VerifyReport = {
  at: number; sig: string; total: number; ok: number;
  missing: FileCheck[]; corrupt: FileCheck[]; unverifiable: FileCheck[]; network: FileCheck[];
  lyricsCached: number; lyricsNeeded: boolean; lyricsOk: boolean; metadataBad: number;
  bytesNeeded: number; freeBytes: number | null; storageOk: boolean;
  passed: boolean; reasons: string[];
};
export type VerifyDeps = {
  /** Native file checks (Android). Absent in a browser. */
  nativeVerify?: (uris: string[]) => Promise<VerifyRaw[]>;
  /** Browser-stored (`local:`) files. */
  webFile?: (id: string) => Promise<Blob | undefined>;
  freeBytes?: () => Promise<number | null>;
  lyricKeys: Set<string>; now?: () => number; onProgress?: (done: number, total: number) => void;
};

const MAGIC = (b: Uint8Array) => { const s = String.fromCharCode(...b.slice(0, 4)); return s.startsWith('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) || s === 'fLaC' || s === 'OggS' || s === 'RIFF' || String.fromCharCode(...b.slice(4, 8)) === 'ftyp'; };

/** Verify that everything in the journey mix can play with NO connection. READY is only possible if this passes. */
export async function verifyJourney(tracks: Track[], plan: Pick<JourneyPlan, 'prefs'>, d: VerifyDeps): Promise<VerifyReport> {
  const checks: FileCheck[] = []; const chunks: Track[][] = []; for (let i = 0; i < tracks.length; i += 25) chunks.push(tracks.slice(i, i + 25));
  let done = 0;
  for (const chunk of chunks) {
    const native = chunk.filter(t => /^(content|file):/.test(t.url)); const web = chunk.filter(t => t.url.startsWith('local:')); const net = chunk.filter(t => /^https?:/.test(t.url));
    for (const t of net) checks.push({ id: t.id, title: t.title, status: 'network', detail: 'This song streams from the internet — it will not play offline' });
    if (native.length) {
      if (!d.nativeVerify) native.forEach(t => checks.push({ id: t.id, title: t.title, status: 'unverifiable', detail: 'Device files can only be checked inside the Android app' }));
      else {
        let res: VerifyRaw[] = []; try { res = await d.nativeVerify(native.map(t => t.url)); } catch (e) { res = []; native.forEach(t => checks.push({ id: t.id, title: t.title, status: 'unverifiable', detail: `Check failed: ${(e as Error).message}` })); }
        const by = new Map(res.map(r => [r.uri, r]));
        for (const t of native) { const r = by.get(t.url); if (!r) { if (!checks.some(c => c.id === t.id)) checks.push({ id: t.id, title: t.title, status: 'unverifiable', detail: 'No result from the device check' }); continue; }
          if (!r.exists || !r.readable) checks.push({ id: t.id, title: t.title, status: 'missing', detail: r.error ? `Cannot open the file (${r.error})` : 'The file is missing or unreadable' });
          else if (r.size > 0 && r.size < 10_000) checks.push({ id: t.id, title: t.title, status: 'corrupt', detail: `Only ${r.size} bytes — not a complete song` });
          else if (!r.header || !r.decodable) checks.push({ id: t.id, title: t.title, status: 'corrupt', detail: !r.header ? 'File does not start like audio' : 'Android cannot decode this file' });
          else if (t.duration && r.durationMs && Math.abs(r.durationMs / 1000 - t.duration) > Math.max(5, t.duration * 0.05)) checks.push({ id: t.id, title: t.title, status: 'corrupt', detail: `Length ${Math.round(r.durationMs / 1000)} s does not match the recorded ${t.duration} s — possibly truncated` });
          else checks.push({ id: t.id, title: t.title, status: 'ok', detail: 'Readable, valid audio, decodable' }); }
      }
    }
    for (const t of web) {
      const blob = d.webFile ? await d.webFile(t.url.slice(6)) : undefined;
      if (!blob) checks.push({ id: t.id, title: t.title, status: 'missing', detail: 'The imported file is no longer stored' });
      else if (blob.size < 10_000) checks.push({ id: t.id, title: t.title, status: 'corrupt', detail: `Only ${blob.size} bytes` });
      else if (!MAGIC(new Uint8Array(await blob.slice(0, 12).arrayBuffer()))) checks.push({ id: t.id, title: t.title, status: 'corrupt', detail: 'File does not start like audio' });
      else checks.push({ id: t.id, title: t.title, status: 'ok', detail: 'Stored in the app and valid' });
    }
    for (const t of chunk) if (!checks.some(c => c.id === t.id)) checks.push({ id: t.id, title: t.title, status: 'unverifiable', detail: 'Unknown file location' });
    done += chunk.length; d.onProgress?.(done, tracks.length);
  }
  const pick = (s: FileStatus) => checks.filter(c => c.status === s);
  const lyricsCached = tracks.filter(t => d.lyricKeys.has(lyricsKey(t))).length; const lyricsNeeded = !!plan.prefs.sing;
  const lyricsOk = !lyricsNeeded || !tracks.length || lyricsCached / tracks.length >= 0.9;
  const metadataBad = tracks.filter(t => !t.title?.trim()).length;
  const bytesNeeded = 0;                                   // files are already on the device; nothing more is downloaded during the trip
  const freeBytes = d.freeBytes ? await d.freeBytes().catch(() => null) : null; const storageOk = freeBytes == null || freeBytes > 200 * 1024 * 1024;   // headroom for caches, artwork and playback buffers
  const reasons: string[] = [];
  if (!tracks.length) reasons.push('There are no songs in the journey mix');
  if (pick('missing').length) reasons.push(`${pick('missing').length} file(s) are missing`);
  if (pick('corrupt').length) reasons.push(`${pick('corrupt').length} file(s) look damaged`);
  if (pick('unverifiable').length) reasons.push(`${pick('unverifiable').length} file(s) could not be checked`);
  if (pick('network').length) reasons.push(`${pick('network').length} song(s) need the internet`);
  if (!lyricsOk) reasons.push(`Lyrics are stored for only ${lyricsCached} of ${tracks.length} songs (sing-along is on)`);
  if (metadataBad) reasons.push(`${metadataBad} song(s) have no title`);
  if (!storageOk) reasons.push('The device is almost out of free space');
  return { at: (d.now ?? Date.now)(), sig: selectionSig(tracks), total: tracks.length, ok: pick('ok').length, missing: pick('missing'), corrupt: pick('corrupt'), unverifiable: pick('unverifiable'), network: pick('network'),
    lyricsCached, lyricsNeeded, lyricsOk, metadataBad, bytesNeeded, freeBytes, storageOk, passed: reasons.length === 0, reasons };
}
