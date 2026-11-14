import { describe, expect, it } from 'vitest';
import { buildChecklist, buildInventory, fmtBytes, isOfflineTrack, readiness, selectForJourney, trackBytes } from '../src/lib/journey/inventory';
import { defaultPlan } from '../src/lib/journey/types';
import { LyricsCache, lyricsKey } from '../src/lib/lyricsCache';
import { MemoryKV } from '../src/lib/collector/kv';
import type { Track } from '../src/lib/types';

const MB = 1024 * 1024;
const t = (i: number, o: Partial<Track> = {}): Track => ({ id: `lo-${i}`, title: `Song ${i}`, artist: 'Arijit Singh', art: '', url: `content://media/external/audio/media/${i}`, source: 'local', duration: 240, size: 5 * MB, ...o });
const lib = (n: number, o: (i: number) => Partial<Track> = () => ({})) => Array.from({ length: n }, (_, i) => t(i, o(i)));
const plan = (o: Partial<ReturnType<typeof defaultPlan>> = {}) => ({ ...defaultPlan(), ...o });

describe('offline inventory', () => {
  it('counts only on-device audio as offline (previews / streams never count)', () => {
    const local = [t(1), t(2, { source: 'itunes', url: 'https://x/p.m4a', preview: true }), t(3, { source: 'jamendo', url: 'https://x' }), t(4, { url: '' })];
    expect(local.filter(isOfflineTrack).map(x => x.id)).toEqual(['lo-1']);
    expect(buildInventory({ local, importedStatuses: [], lyricKeys: new Set() }).music.count).toBe(1);
  });
  it('sums duration/bytes, uses real sizes and flags estimates when size is unknown', () => {
    const inv = buildInventory({ local: [t(1), t(2, { size: undefined, duration: 100 })], importedStatuses: [], lyricKeys: new Set() });
    expect(inv.music.bytes).toBe(5 * MB + 100 * 16000); expect(inv.music.estimatedBytes).toBe(100 * 16000); expect(inv.music.seconds).toBe(340);
    expect(trackBytes(t(3, { size: undefined, duration: undefined })).estimated).toBe(true);
  });
  it('lists genres (split on ; , /) and cached-lyric coverage', () => {
    const local = [t(1, { genre: 'Bollywood; Romantic' }), t(2, { genre: 'Bollywood' }), t(3)];
    const inv = buildInventory({ local, importedStatuses: [], lyricKeys: new Set([lyricsKey(local[0])]) });
    expect(inv.music.genres).toEqual([{ name: 'Bollywood', count: 2 }, { name: 'Romantic', count: 1 }]); expect(inv.music.withLyrics).toBe(1); expect(inv.music.withGenre).toBe(2);
  });
  it('imported Spotify/YouTube songs are never counted as offline unless downloaded', () => {
    const inv = buildInventory({ local: [], importedStatuses: ['pending_match', 'pending_match', 'matched', 'download_permitted', 'downloaded'], lyricKeys: new Set() });
    expect(inv.imported).toMatchObject({ total: 5, availableOffline: 1 }); expect(inv.imported.byStatus.pending_match).toBe(2);
  });
});

describe('journey selection / storage estimator', () => {
  it('fills the requested duration and stops', () => {
    const s = selectForJourney(lib(100), plan({ hours: 2 }));       // 4-minute songs → 30 needed
    expect(s.stoppedBy).toBe('duration'); expect(s.seconds).toBeGreaterThanOrEqual(7200); expect(s.seconds).toBeLessThan(7200 + 240); expect(s.tracks.length).toBe(30);
  });
  it('never exceeds the storage limit and reports why it stopped', () => {
    const s = selectForJourney(lib(100), plan({ hours: 12, storageMB: 50 }));
    expect(s.bytes).toBeLessThanOrEqual(50 * MB); expect(s.tracks.length).toBe(10); expect(s.stoppedBy).toBe('storage');
  });
  it('a smaller track can still fit after a large one is skipped', () => {
    const s = selectForJourney([t(1, { size: 9 * MB }), t(2, { size: 9 * MB }), t(3, { size: 1 * MB })], plan({ hours: 12, storageMB: 11 }));
    expect(s.tracks.map(x => x.id)).toContain('lo-3'); expect(s.bytes).toBeLessThanOrEqual(11 * MB); expect(s.tracks.length).toBe(2);   // one 9 MB song + the 1 MB song
  });
  it('reports "library" when everything fits but the journey is longer than the library', () => {
    const s = selectForJourney(lib(5), plan({ hours: 12 })); expect(s.stoppedBy).toBe('library'); expect(s.tracks.length).toBe(5);
  });
  it('filters by genre, falls back (flagged) when no file has the genre', () => {
    const local = lib(10, i => ({ genre: i < 4 ? 'Sufi' : 'Pop' }));
    expect(selectForJourney(local, plan({ genres: ['sufi'], hours: 12 })).tracks.length).toBe(4);
    const fb = selectForJourney(local, plan({ genres: ['Jazz'], hours: 12 })); expect(fb.genreFallback).toBe(true); expect(fb.tracks.length).toBe(10);
  });
  it('is deterministic for the same plan and library', () => {
    const a = selectForJourney(lib(50), plan()).tracks.map(x => x.id), b = selectForJourney(lib(50), plan()).tracks.map(x => x.id); expect(a).toEqual(b);
  });
  it('fmtBytes', () => { expect(fmtBytes(5 * MB)).toBe('5 MB'); expect(fmtBytes(3 * 1024 ** 3)).toBe('3.0 GB'); });
});

describe('checklist & READY / NOT READY', () => {
  const mk = (n: number, p = plan(), verified: { passed: boolean; at: number } | null = null, keys = new Set<string>()) => {
    const local = lib(n); const inv = buildInventory({ local, importedStatuses: [], lyricKeys: keys }); const sel = selectForJourney(local, p);
    return buildChecklist(p, inv, sel, verified, keys);
  };
  it('empty library → music check fails and journey is NOT READY', () => {
    const items = mk(0); expect(items.find(i => i.id === 'music')!.level).toBe('fail'); const r = readiness(items); expect(r.status).toBe('NOT_READY'); expect(r.blockers).toContain('Offline music covers the journey');
  });
  it('enough music but verification not run → still NOT READY (never READY by assumption)', () => {
    const items = mk(100); expect(items.find(i => i.id === 'music')!.level).toBe('ok'); expect(items.find(i => i.id === 'verify')!.level).toBe('todo');
    expect(readiness(items).status).toBe('NOT_READY'); expect(readiness(items).blockers).toEqual(['Offline playback verified']);
  });
  it('READY only when coverage is complete AND verification passed', () => {
    expect(readiness(mk(100, plan(), { passed: true, at: 1 })).status).toBe('READY');
    expect(readiness(mk(100, plan(), { passed: false, at: 1 })).status).toBe('NOT_READY');
    expect(readiness(mk(10, plan(), { passed: true, at: 1 })).status).toBe('NOT_READY');   // 10 songs ≈ 40 min for a 5 h trip
  });
  it('partial coverage is a warning, low coverage a failure', () => {
    expect(mk(80).find(i => i.id === 'music')!.level).toBe('ok');     // 80 × 4 min = 5h20m covers a 5 h trip
    expect(mk(80, plan({ hours: 8 })).find(i => i.id === 'music')!.level).toBe('warn');
    expect(mk(20, plan({ hours: 8 })).find(i => i.id === 'music')!.level).toBe('fail');
  });
  it('flags missing stories/podcasts/sleep content instead of pretending it exists', () => {
    const items = mk(100); for (const id of ['stories', 'podcasts', 'sleep']) expect(items.find(i => i.id === id)!.level).toBe('warn');
    const off = mk(100, plan({ prefs: { ...plan().prefs, stories: false, podcasts: false, sleep: false } })); expect(off.find(i => i.id === 'stories')).toBeUndefined();
  });
  it('lyrics coverage reflects the cache', () => {
    const local = lib(100); const keys = new Set(local.map(lyricsKey));
    expect(mk(100, plan(), null, keys).find(i => i.id === 'lyrics')!.level).toBe('ok'); expect(mk(100).find(i => i.id === 'lyrics')!.level).toBe('warn');
  });
});

describe('lyrics cache (offline lyrics)', () => {
  it('stores and returns lyrics by normalised key; remembers "no lyrics" with a TTL', async () => {
    let now = 1000; const c = new LyricsCache(new MemoryKV(), () => now); const song = { title: 'Tum Hi Ho (From "Aashiqui 2")', artist: 'Arijit Singh' };
    expect((await c.get(song)).hit).toBe(false); await c.put(song, '[00:01.00]Tum hi ho');
    expect(await c.get({ title: 'tum hi ho', artist: 'ARIJIT SINGH' })).toEqual({ hit: true, text: '[00:01.00]Tum hi ho' });
    await c.put({ title: 'Obscure', artist: 'X' }, null); expect(await c.get({ title: 'Obscure', artist: 'X' })).toEqual({ hit: true, text: null });
    now += 8 * 24 * 3600_000; expect((await c.get({ title: 'Obscure', artist: 'X' })).hit).toBe(false);     // negative entry expired → re-check
    expect((await c.get(song)).hit).toBe(true);                                                          // positive entries never expire
    expect((await c.cachedKeys()).size).toBe(1);
  });
});
