import { fetchLyrics } from '../sources';
import { lyricsCache } from '../lyricsCache';
import { artCache } from '../artCache';
import type { Track } from '../types';

export type CacheResult = { cached: number; none: number; failed: number; skipped: number };

/** Download + store lyrics for the given tracks (needs a connection once; afterwards lyrics work offline). */
export async function cacheLyricsFor(tracks: Track[], onProgress?: (done: number, total: number) => void, concurrency = 3): Promise<CacheResult> {
  const r: CacheResult = { cached: 0, none: 0, failed: 0, skipped: 0 };
  const have = await lyricsCache.cachedKeys(); const { lyricsKey } = await import('../lyricsCache');
  const todo = tracks.filter(t => { if (have.has(lyricsKey(t))) { r.skipped++; return false; } return true; });
  let i = 0, done = r.skipped;
  const worker = async () => {
    while (i < todo.length) {
      const t = todo[i++];
      try { const text = await fetchLyrics(t); const hit = await lyricsCache.get(t); if (text) r.cached++; else if (hit.hit) r.none++; else r.failed++; }
      catch { r.failed++; }
      onProgress?.(++done, tracks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  return r;
}

export type ArtResult = { cached: number; failed: number; skipped: number };

/** Download + store artwork for the given tracks (needs a connection once; afterwards covers show up offline too).
 *  Tracks already stored on device (content://, local: or blob: art) need no caching and are counted as skipped. */
export async function cacheArtFor(tracks: Track[], onProgress?: (done: number, total: number) => void, concurrency = 3): Promise<ArtResult> {
  const r: ArtResult = { cached: 0, failed: 0, skipped: 0 };
  const todo: Track[] = []; const seen = new Set<string>();
  for (const t of tracks) {
    if (!t.art || !/^https?:/.test(t.art) || seen.has(t.art)) { r.skipped++; continue; }
    if (await artCache.has(t.art)) { r.skipped++; continue; }
    seen.add(t.art); todo.push(t);
  }
  let i = 0, done = r.skipped;
  const worker = async () => {
    while (i < todo.length) {
      const t = todo[i++];
      await artCache.warm(t.art);
      if (await artCache.has(t.art)) r.cached++; else r.failed++;
      onProgress?.(++done, tracks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  return r;
}
