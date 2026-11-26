import { describe, expect, it, vi } from 'vitest';
import { ArtCache, type CachedArt } from '../src/lib/artCache';
import { MemoryKV } from '../src/lib/collector/kv';
import type { Track } from '../src/lib/types';

// prepare.ts uses the real IndexedDB-backed `artCache` singleton, which doesn't exist under vitest's node
// environment; swap it for an in-memory one so cacheArtFor can be tested without a browser.
vi.mock('../src/lib/artCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/artCache')>();
  return { ...actual, artCache: new actual.ArtCache(new (await import('../src/lib/collector/kv')).MemoryKV()) };
});
const { cacheArtFor } = await import('../src/lib/journey/prepare');

// Blob/URL.createObjectURL exist in jsdom-less vitest (node) only partially; stub what's missing.
(globalThis as any).Blob ??= class { size: number; type: string; constructor(parts: any[] = [], o: any = {}) { this.size = parts.reduce((n, p) => n + (p?.length ?? p?.size ?? 0), 0); this.type = o.type ?? ''; } };
(globalThis as any).URL.createObjectURL ??= (b: Blob) => `blob:mock/${(b as any).type}/${b.size}`;

const blob = (bytes = 2000, type = 'image/jpeg') => new Blob([new Uint8Array(bytes)], { type });
const mkTrack = (i: number, art = `https://cdn/art${i}.jpg`): Track => ({ id: `t${i}`, title: `Song ${i}`, artist: 'A', art, url: `https://x/${i}.mp3`, source: 'jamendo' });

describe('ArtCache', () => {
  it('passes through non-http art (already local) without fetching', async () => {
    const fetchImpl = vi.fn(); const ac = new ArtCache(new MemoryKV<CachedArt>(), fetchImpl);
    expect(await ac.resolve('content://media/1')).toBe('content://media/1');
    expect(await ac.resolve(undefined)).toBe(undefined);
    expect(await ac.resolve('')).toBe('');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('resolve() returns the original URL until warm() has cached it, then a local object URL', async () => {
    const fetchImpl = vi.fn(async () => blob()); const ac = new ArtCache(new MemoryKV<CachedArt>(), fetchImpl);
    const url = 'https://cdn/cover.jpg';
    expect(await ac.resolve(url)).toBe(url); // not cached yet
    await ac.warm(url);
    expect(await ac.has(url)).toBe(true);
    const resolved = await ac.resolve(url); expect(resolved).not.toBe(url); expect(resolved).toMatch(/^blob:/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await ac.warm(url); expect(fetchImpl).toHaveBeenCalledTimes(1); // already cached — no second fetch
  });
  it('warm() silently ignores network failures, tiny responses and oversized ones', async () => {
    const kv = new MemoryKV<CachedArt>();
    await new ArtCache(kv, async () => { throw new Error('offline'); }).warm('https://cdn/a.jpg');
    await new ArtCache(kv, async () => null).warm('https://cdn/b.jpg');
    await new ArtCache(kv, async () => blob(10)).warm('https://cdn/c.jpg');            // too small to be a real image
    await new ArtCache(kv, async () => blob(6 * 1024 * 1024)).warm('https://cdn/d.jpg'); // over the size cap
    expect(await kv.all()).toEqual([]);
  });
});

describe('cacheArtFor (Journey prepare, using the real exported artCache singleton)', () => {
  it('caches each distinct remote cover once, skips device-local art, duplicates and empty art, counts a failed fetch', async () => {
    const tracks: Track[] = [mkTrack(1), mkTrack(2), { ...mkTrack(1), id: 't1dup' } /* same art URL as t1 */, { ...mkTrack(3), art: 'content://media/3' }, { ...mkTrack(4), art: '' }];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('art2')) return new Response(null, { status: 404 }); // simulate a genuine fetch failure for one song
      return new Response(new Uint8Array(2000), { status: 200 });
    });
    const r = await cacheArtFor(tracks);
    expect(r.skipped).toBe(3); // the duplicate (same art URL as t1), the content:// one, and the empty one
    expect(r.cached).toBe(1); expect(r.failed).toBe(1); // art1 cached, art2's 404 counted as a failure
    expect(fetchSpy).toHaveBeenCalledTimes(2); // exactly the two distinct remote URLs, never the duplicate
    fetchSpy.mockRestore();
  });
});
