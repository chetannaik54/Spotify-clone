import { fetchLyrics } from '../sources';
import { lyricsCache } from '../lyricsCache';
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
