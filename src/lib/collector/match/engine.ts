import type { Catalogue } from '../catalogue';
import type { ImportedTrack, MatchingStatus } from '../types';
import { MIN_KEPT, scoreCandidate } from './score';
import type { Candidate, MatchQuery, MatchRecord, MatchSource, ScoredCandidate, SourceId } from './types';

export const queryFor = (t: ImportedTrack): MatchQuery => ({ title: t.song_title, artist: t.artist_name, album: t.album_name, duration_ms: t.duration_ms });

/** Status implied by a record. Exact + permitted ⇒ download_permitted; local ⇒ downloaded; unconfirmed ⇒ possible_match. */
export function statusOf(r: MatchRecord): MatchingStatus {
  const sel = r.candidates.find(c => c.key === r.selected);
  if (sel) return sel.download.local ? 'downloaded' : sel.download.permitted && sel.download.verified ? 'download_permitted' : 'matched';
  if (r.skipped) return 'unavailable';
  if (r.candidates.length) return 'possible_match';
  // "No match" is only truthful when EVERY source was searched; if any source failed, the answer is "couldn't finish" (retryable)
  return r.errors.length ? 'failed' : 'no_match';
}

export type MatchOptions = { sources: MatchSource[]; timeoutMs?: number; now?: () => number };

/** Search every source independently (one failing source never blocks the others), score, rank, and decide the safe default selection. */
export async function matchTrack(t: ImportedTrack, prev: MatchRecord | undefined, o: MatchOptions, signal?: AbortSignal): Promise<MatchRecord> {
  const q = queryFor(t); const errors: MatchRecord['errors'] = [];
  const raw: Candidate[] = [];
  await Promise.all(o.sources.map(async s => {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), o.timeoutMs ?? 15000); signal?.addEventListener('abort', () => ac.abort(), { once: true });
    try { raw.push(...await s.search(q, ac.signal)); }
    catch (e) { errors.push({ source: s.id as SourceId, message: ac.signal.aborted && !signal?.aborted ? 'timed out' : (e as Error).message }); }
    finally { clearTimeout(timer); }
  }));
  const rejected = prev?.rejected ?? [];
  const seen = new Set<string>(); const scored: ScoredCandidate[] = [];
  for (const c of raw) { if (seen.has(c.key) || rejected.includes(c.key)) continue; seen.add(c.key); const sc = scoreCandidate(q, c); if (sc.confidence >= MIN_KEPT) scored.push(sc); }
  // best confidence first; among near-equals prefer a verified downloadable one, then a local file
  scored.sort((a, b) => (Math.abs(b.confidence - a.confidence) <= 2 ? Number(b.download.permitted) - Number(a.download.permitted) || Number(!!b.download.local) - Number(!!a.download.local) : 0) || b.confidence - a.confidence);
  const best = scored[0];
  const keepUser = prev?.selected_by === 'user' && prev.selected && scored.some(c => c.key === prev.selected);
  const autoOk = !!best && best.band === 'exact' && !best.flags.length;      // flags (version/artist/duration/unknown artist) always force a human look
  return {
    track_id: t.id, candidates: scored.slice(0, 5), band: best?.band ?? null, rejected, errors, skipped: false, checked_at: (o.now ?? Date.now)(),
    selected: keepUser ? prev!.selected : autoOk ? best.key : null, selected_by: keepUser ? 'user' : autoOk ? 'auto' : null,
  };
}

export type RunProgress = { done: number; total: number; current: string; failed: number };
export type RunOptions = MatchOptions & { concurrency?: number; onProgress?: (p: RunProgress) => void; force?: boolean; signal?: AbortSignal };

/** Match many tracks. Never touches tracks that are already downloaded or that the user confirmed/skipped (unless forced). */
export async function matchMany(cat: Catalogue, tracks: ImportedTrack[], o: RunOptions) {
  const todo = tracks.filter(t => t.import_status === 'imported' && t.matching_status !== 'downloaded' && (o.force || !['matched', 'download_permitted'].includes(t.matching_status)));
  let done = 0, failed = 0; const total = todo.length; let i = 0;
  const worker = async () => {
    while (i < todo.length && !o.signal?.aborted) {
      const t = todo[i++]; o.onProgress?.({ done, total, current: t.song_title, failed });
      const prev = await cat.getMatch(t.id);
      if (prev?.skipped && !o.force) { done++; continue; }
      const rec = await matchTrack(t, prev, o, o.signal);
      const st = statusOf(rec); if (st === 'failed') failed++;
      await cat.putMatch(rec, st, rec.candidates.find(c => c.key === rec.selected && c.download.local)?.source_id ?? null);
      done++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency ?? 2, Math.max(1, todo.length)) }, worker));
  o.onProgress?.({ done, total, current: '', failed });
  return { total, done, failed };
}

// ---- user decisions ----
export async function confirmMatch(cat: Catalogue, trackId: string, key: string) {
  const r = await cat.getMatch(trackId); const c = r?.candidates.find(x => x.key === key); if (!r || !c) return;
  const rec: MatchRecord = { ...r, selected: key, selected_by: 'user', skipped: false }; await cat.putMatch(rec, statusOf(rec), c.download.local ? c.source_id : null);
}
export async function rejectMatch(cat: Catalogue, trackId: string, key?: string) {
  const r = await cat.getMatch(trackId); if (!r) return; const k = key ?? r.selected; if (!k) return;
  const rec: MatchRecord = { ...r, rejected: [...new Set([...r.rejected, k])], candidates: r.candidates.filter(c => c.key !== k), selected: r.selected === k ? null : r.selected, selected_by: r.selected === k ? null : r.selected_by };
  rec.band = rec.candidates[0]?.band ?? null; await cat.putMatch(rec, statusOf(rec), null);
}
export async function skipTrack(cat: Catalogue, trackId: string, skip = true) {
  const r = (await cat.getMatch(trackId)) ?? { track_id: trackId, candidates: [], selected: null, selected_by: null, band: null, rejected: [], errors: [], skipped: false, checked_at: Date.now() };
  const rec: MatchRecord = { ...r, skipped: skip, selected: skip ? null : r.selected, selected_by: skip ? null : r.selected_by };
  await cat.putMatch(rec, skip ? 'unavailable' : statusOf(rec), null);
}
