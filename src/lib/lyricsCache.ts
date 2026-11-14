import { IdbKV, type KV } from './collector/kv';
import type { Track } from './types';

export type CachedLyrics = { key: string; text: string | null; at: number };
const NEG_TTL = 7 * 24 * 3600_000; // re-check "no lyrics" results after a week

/** Normalised cache key so tiny title differences don't miss. */
export const lyricsKey = (t: Pick<Track, 'title' | 'artist'>) =>
  `${t.artist}|${t.title}`.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^\p{L}\p{N}|]+/gu, ' ').trim();

/** Persistent lyric cache (IndexedDB). Lets lyrics work with no connection once prepared. */
export class LyricsCache {
  constructor(private kv: KV<CachedLyrics>, private now: () => number = Date.now) {}
  async get(t: Pick<Track, 'title' | 'artist'>): Promise<{ hit: boolean; text: string | null }> {
    const r = await this.kv.get(lyricsKey(t));
    if (!r) return { hit: false, text: null };
    if (r.text === null && this.now() - r.at > NEG_TTL) return { hit: false, text: null };
    return { hit: true, text: r.text };
  }
  async put(t: Pick<Track, 'title' | 'artist'>, text: string | null) { const key = lyricsKey(t); await this.kv.put(key, { key, text, at: this.now() }); }
  async cachedKeys(): Promise<Set<string>> { return new Set((await this.kv.all()).filter(r => r.text).map(r => r.key)); }
  async count() { return (await this.kv.all()).filter(r => r.text).length; }
}
export const lyricsCache = new LyricsCache(new IdbKV<CachedLyrics>('lyrics'));
