import type { Track } from '../types';
import { lyricsKey } from '../lyricsCache';
import type { Experience, JourneyPlan } from './types';

/** When a file's size is unknown, assume 128 kbps. Flagged as an estimate in the UI. */
export const FALLBACK_BYTES_PER_SEC = 16_000;
const MB = 1024 * 1024;

export const trackBytes = (t: Track): { bytes: number; estimated: boolean } =>
  t.size && t.size > 0 ? { bytes: t.size, estimated: false } : { bytes: Math.round((t.duration ?? 210) * FALLBACK_BYTES_PER_SEC), estimated: true };
export const trackSeconds = (t: Track) => t.duration && t.duration > 0 ? t.duration : 210;

/** Only audio that physically lives on this device counts as offline. Online previews/streams never do. */
export const isOfflineTrack = (t: Track) => t.source === 'local' && !!t.url;

export type Inventory = {
  music: { count: number; seconds: number; bytes: number; estimatedBytes: number; withLyrics: number; withGenre: number; genres: { name: string; count: number }[] };
  imported: { total: number; byStatus: Record<string, number>; availableOffline: number };
  library: Record<'stories' | 'podcasts' | 'sleep', number>;       // user/licensed audio library (Milestones 6–7)
};

export type InventoryInput = {
  local: Track[];
  importedStatuses: string[];                 // matching_status of every imported catalogue track
  lyricKeys: Set<string>;
  library?: Partial<Record<'stories' | 'podcasts' | 'sleep', number>>;
};

export function buildInventory(i: InventoryInput): Inventory {
  const off = i.local.filter(isOfflineTrack);
  const genres = new Map<string, number>();
  let seconds = 0, bytes = 0, est = 0, withLyrics = 0, withGenre = 0;
  for (const t of off) {
    const b = trackBytes(t); bytes += b.bytes; if (b.estimated) est += b.bytes; seconds += trackSeconds(t);
    if (i.lyricKeys.has(lyricsKey(t))) withLyrics++;
    for (const g of splitGenres(t.genre)) { genres.set(g, (genres.get(g) ?? 0) + 1); }
    if (t.genre) withGenre++;
  }
  const byStatus: Record<string, number> = {}; for (const s of i.importedStatuses) byStatus[s] = (byStatus[s] ?? 0) + 1;
  return {
    music: { count: off.length, seconds, bytes, estimatedBytes: est, withLyrics, withGenre, genres: [...genres].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count) },
    imported: { total: i.importedStatuses.length, byStatus, availableOffline: byStatus['downloaded'] ?? 0 },
    library: { stories: i.library?.stories ?? 0, podcasts: i.library?.podcasts ?? 0, sleep: i.library?.sleep ?? 0 },
  };
}

export const splitGenres = (g?: string) => (g ?? '').split(/[;,/]+/).map(x => x.trim()).filter(Boolean);

// ---------- selection (v1; Milestone 3 refines this) ----------
export type Selection = { tracks: Track[]; seconds: number; bytes: number; estimatedBytes: number; stoppedBy: 'duration' | 'storage' | 'library'; genreFallback: boolean };

/** Deterministic hash so the same plan yields the same mix until the library changes. */
const h = (s: string) => { let x = 2166136261; for (let k = 0; k < s.length; k++) { x ^= s.charCodeAt(k); x = Math.imul(x, 16777619); } return x >>> 0; };

export function selectForJourney(local: Track[], plan: Pick<JourneyPlan, 'hours' | 'storageMB' | 'genres' | 'type'>): Selection {
  const pool = local.filter(isOfflineTrack);
  const want = plan.genres.map(g => g.toLowerCase());
  let cand = want.length ? pool.filter(t => splitGenres(t.genre).some(g => want.includes(g.toLowerCase()))) : pool;
  const genreFallback = want.length > 0 && cand.length === 0;
  if (genreFallback) cand = pool;
  cand = [...cand].sort((a, b) => h(plan.type + a.id) - h(plan.type + b.id));
  const targetSec = plan.hours * 3600, limit = plan.storageMB * MB;
  const out: Track[] = []; let seconds = 0, bytes = 0, estimatedBytes = 0, stoppedBy: Selection['stoppedBy'] = 'library';
  for (const t of cand) {
    if (seconds >= targetSec) { stoppedBy = 'duration'; break; }
    const b = trackBytes(t);
    if (bytes + b.bytes > limit) { stoppedBy = 'storage'; continue; }   // skip this one; a smaller track may still fit
    out.push(t); seconds += trackSeconds(t); bytes += b.bytes; if (b.estimated) estimatedBytes += b.bytes;
  }
  if (seconds >= targetSec) stoppedBy = 'duration';
  return { tracks: out, seconds, bytes, estimatedBytes, stoppedBy, genreFallback };
}

// ---------- checklist & readiness ----------
export type Level = 'ok' | 'warn' | 'fail' | 'todo' | 'info';
export type CheckItem = { id: string; label: string; detail: string; level: Level; mandatory: boolean };
export type Readiness = { status: 'READY' | 'NOT_READY'; blockers: string[]; percent: number };

export const fmtDur = (sec: number) => { const m = Math.round(sec / 60), hh = Math.floor(m / 60); return hh ? `${hh}h ${m % 60}m` : `${m}m`; };
export const fmtBytes = (b: number) => b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(b / MB))} MB`;

/** Fingerprint of what a verification covered. If the mix or the files change, the old verification no longer counts. */
export const selectionSig = (tracks: Track[]) => { let h = 2166136261; for (const t of tracks) { const k = `${t.id}|${t.size ?? 0}|${t.url}`; for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619); } } return `${tracks.length}:${(h >>> 0).toString(36)}`; };

export function buildChecklist(plan: JourneyPlan, inv: Inventory, sel: Selection, verifiedIn: { passed: boolean; at: number; sig?: string; report?: { reasons: string[] } } | null, lyricKeys: Set<string> = new Set()): CheckItem[] {
  const need = plan.hours * 3600, cover = need ? sel.seconds / need : 0;
  const stale = !!verifiedIn && verifiedIn.sig !== undefined && verifiedIn.sig !== selectionSig(sel.tracks);
  const verified = stale ? null : verifiedIn;
  const items: CheckItem[] = [];
  if (plan.prefs.music) items.push({
    id: 'music', mandatory: true, label: 'Offline music covers the journey',
    detail: inv.music.count === 0 ? 'No music is stored on this device yet — scan your device or add files in Library' : `${fmtDur(sel.seconds)} of ${fmtDur(need)} needed (${Math.round(cover * 100)}%)`,
    level: cover >= 1 ? 'ok' : cover >= 0.6 ? 'warn' : 'fail',
  });
  items.push({
    id: 'storage', mandatory: true, label: 'Storage within your limit',
    detail: `${fmtBytes(sel.bytes)} of ${fmtBytes(plan.storageMB * MB)}${sel.estimatedBytes ? ` · ${fmtBytes(sel.estimatedBytes)} estimated from duration` : ''}${sel.stoppedBy === 'storage' ? ' · limit reached before the journey was covered' : ''}`,
    level: sel.stoppedBy === 'storage' && cover < 1 ? 'warn' : 'ok',
  });
  if (plan.genres.length) items.push({
    id: 'genres', mandatory: false, label: 'Preferred genres',
    detail: sel.genreFallback ? 'None of your files carry those genre tags — using your whole library' : inv.music.withGenre ? `Filtering by ${plan.genres.join(', ')}` : 'Your files have no genre tags',
    level: sel.genreFallback ? 'warn' : 'info',
  });
  if (plan.prefs.sing && sel.tracks.length) {
    const n = sel.tracks.filter(t => lyricKeys.has(lyricsKey(t))).length, share = n / sel.tracks.length;
    items.push({ id: 'lyrics', mandatory: false, label: 'Lyrics cached for sing-along', detail: `${n} of ${sel.tracks.length} songs have lyrics stored on this device`, level: share >= 0.9 ? 'ok' : 'warn' });
  }
  const need2: [Experience, 'stories' | 'podcasts' | 'sleep', string][] = [['stories', 'stories', 'Audio stories'], ['podcasts', 'podcasts', 'Podcasts'], ['sleep', 'sleep', 'Sleep sounds']];
  for (const [exp, key, label] of need2) if (plan.prefs[exp]) items.push({ id: key, mandatory: false, label, detail: inv.library[key] ? `${inv.library[key]} items stored offline` : 'Nothing stored offline yet', level: inv.library[key] ? 'ok' : 'warn' });
  if (inv.imported.total) items.push({ id: 'imported', mandatory: false, label: 'Imported playlists (Spotify / YouTube)',
    detail: `${inv.imported.total} imported songs · ${inv.imported.availableOffline} stored offline. Imported songs are only usable offline once a licensed, downloadable copy exists.`, level: 'info' });
  items.push({
    id: 'verify', mandatory: true, label: 'Offline playback verified',
    detail: stale ? 'Your mix or files changed since the last check — run it again' : verified ? (verified.passed ? `Passed ${new Date(verified.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : `Failed: ${verified.report?.reasons?.[0] ?? 'see details'}`) : 'Not run yet — checks every file, its integrity, lyrics and free space',
    level: verified ? (verified.passed ? 'ok' : 'fail') : 'todo',
  });
  return items;
}

export function readiness(items: CheckItem[]): Readiness {
  const blockers = items.filter(i => i.mandatory && i.level !== 'ok').map(i => i.label);
  const scored = items.filter(i => i.level !== 'info');
  const pts = scored.reduce((a, i) => a + (i.level === 'ok' ? 1 : i.level === 'warn' ? 0.5 : 0), 0);
  return { status: blockers.length ? 'NOT_READY' : 'READY', blockers, percent: scored.length ? Math.round((pts / scored.length) * 100) : 0 };
}
