import { IdbKV, type KV } from './collector/kv';
import { fetchBlob } from './http';

export type CachedArt = { key: string; blob: Blob; at: number };
const MAX_BYTES = 5 * 1024 * 1024; // a cover is a few hundred KB at most — refuse anything implausibly large

/**
 * Persistent artwork cache (IndexedDB), the same idea as LyricsCache: once a remote cover image has been
 * fetched, it keeps showing with no connection — most important for downloaded songs, whose `art` field is
 * a remote metadata-source URL that otherwise goes blank the moment the tablet is offline.
 */
export class ArtCache {
  private urls = new Map<string, string>(); // object URLs minted this session; blob: URLs don't survive a reload
  constructor(private kv: KV<CachedArt>, private fetchImpl: (url: string) => Promise<Blob | null> = fetchBlob, private now: () => number = Date.now) {}

  /** A usable <img> src for this URL: a cached local copy if we have one, else the original URL unchanged.
   *  Never fetches and never throws — call warm() to populate the cache ahead of time. */
  async resolve(url: string | undefined): Promise<string | undefined> {
    if (!url || !/^https?:/.test(url)) return url; // already local (content://, blob:, local:) or empty — nothing to do
    const existing = this.urls.get(url); if (existing) return existing;
    const cached = await this.kv.get(url).catch(() => undefined); if (!cached) return url;
    const obj = URL.createObjectURL(cached.blob); this.urls.set(url, obj); return obj;
  }

  /** Fetch and store artwork for offline use. Best-effort: failures (offline, blocked, not an image) are silently ignored. */
  async warm(url: string | undefined): Promise<void> {
    if (!url || !/^https?:/.test(url)) return;
    if (await this.kv.get(url).catch(() => undefined)) return; // already cached
    const blob = await this.fetchImpl(url).catch(() => null);
    if (!blob || blob.size < 100 || blob.size > MAX_BYTES) return;
    await this.kv.put(url, { key: url, blob, at: this.now() });
  }

  async has(url: string | undefined): Promise<boolean> { return !!url && !!(await this.kv.get(url).catch(() => undefined)); }
  async count(): Promise<number> { return (await this.kv.all()).length; }
  async cachedUrls(): Promise<Set<string>> { return new Set((await this.kv.all()).map(r => r.key)); }
}

export const artCache = new ArtCache(new IdbKV<CachedArt>('art_cache'));
