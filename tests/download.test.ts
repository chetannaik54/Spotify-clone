import { beforeEach, describe, expect, it } from 'vitest';
import { Catalogue, memoryStores } from '../src/lib/collector/catalogue';
import { DownloadManager } from '../src/lib/collector/download/manager';
import { TransportError, type DownloadJob, type Settings, type Transport } from '../src/lib/collector/download/types';
import type { MatchRecord, ScoredCandidate } from '../src/lib/collector/match/types';
import type { ImportedTrack } from '../src/lib/collector/types';
import type { Track } from '../src/lib/types';

const MB = 1024 * 1024;
const cand = (o: Partial<ScoredCandidate> = {}): ScoredCandidate => ({ key: 'jamendo:1', source: 'jamendo', source_id: '1', title: 'Tum Hi Ho', artist: 'Arijit Singh', album: 'Aashiqui 2', duration_ms: 262000, artwork_url: 'https://a/1.jpg', page_url: '', quality: { label: 'mp3', lossless: false }, full_length: true,
  download: { permitted: true, verified: true, reason: 'CC BY', license: 'cc-by', url: 'https://dl/1.mp3', format: 'mp3', bytes: 4 * MB }, confidence: 98, band: 'exact', duration_diff_ms: 0, flags: [], parts: { title: 1, artist: 1, duration: 1, album: 1 }, ...o });
const mkTrack = (i: number, o: Partial<ImportedTrack> = {}): ImportedTrack => ({ id: `spotify:t${i}`, user_id: 'u', source_platform: 'spotify', source_track_id: `t${i}`, song_title: i === 0 ? 'Tum Hi Ho' : `Song ${i}`, artist_name: 'Arijit Singh', album_name: 'Aashiqui 2', artwork_url: '', duration_ms: 262000, source_url: '', import_status: 'imported', matching_status: 'download_permitted', local_file_id: null, created_at: 1, updated_at: 1, ...o });
const rec = (id: string, c: ScoredCandidate, by: 'auto' | 'user' = 'auto'): MatchRecord => ({ track_id: id, candidates: [c], selected: c.key, selected_by: by, band: c.band, rejected: [], errors: [], skipped: false, checked_at: 1 });

class FakeTransport implements Transport {
  log: string[] = []; free: number | null = 10 * 1024 * MB; unmetered: boolean | null = true;
  behaviour = new Map<string, (job: DownloadJob, h: Parameters<Transport['download']>[1]) => Promise<{ id: string; url: string; size: number; folder?: string }>>();
  partialKept = new Set<string>(); discarded: string[] = []; starts = 0;
  supported() { return true; } async freeBytes() { return this.free; } async isUnmetered() { return this.unmetered; } async discard(id: string) { this.discarded.push(id); this.partialKept.delete(id); }
  async download(job: DownloadJob, h: Parameters<Transport['download']>[1]) {
    this.starts++; this.log.push(`start:${job.id}`); const b = this.behaviour.get(job.id);
    if (b) return b(job, h);
    h.onProgress(job.total / 2, job.total); return { id: `lo-${job.id}`, url: `content://media/${job.id}`, size: job.expected_bytes ?? 4 * MB, folder: 'Music/Swarify/x' };
  }
}
const hang = (t: FakeTransport) => (job: DownloadJob, h: Parameters<Transport['download']>[1]) => new Promise<never>((_r, rej) => h.signal.addEventListener('abort', () => { if (h.keepPartial()) t.partialKept.add(job.id); rej(new TransportError('Cancelled', 'cancelled')); }));
const settle = async (ms = 20) => new Promise(r => setTimeout(r, ms));

let cat: Catalogue, tr: FakeTransport, mgr: DownloadManager, local: Track[], settings: Settings;
const setup = async (n = 4) => { for (let i = 0; i < n; i++) { await cat.s.tracks.put(`spotify:t${i}`, mkTrack(i)); await cat.putMatch(rec(`spotify:t${i}`, cand({ key: `jamendo:${i}`, download: { permitted: true, verified: true, reason: 'CC BY', url: `https://dl/${i}.mp3`, format: 'mp3', bytes: 4 * MB } })), 'download_permitted', null); } };
beforeEach(() => { cat = new Catalogue(memoryStores()); tr = new FakeTransport(); local = []; settings = { wifiOnly: true, maxStorageMB: 1000, auto: false };
  mgr = new DownloadManager({ cat, transport: tr, settings: () => settings, localTracks: () => local, registerLocal: t => local.push(t), sleep: async () => {}, concurrency: 2 }); });

describe('eligibility: only verified, confirmed, permitted recordings can ever be queued', () => {
  it('queues a permitted exact match', async () => { await setup(1); expect(await mgr.enqueue(['spotify:t0'])).toEqual({ queued: ['spotify:t0'], skipped: [] }); });
  it('refuses: no match record, unverified, not permitted, no URL, local copy, already downloaded', async () => {
    await cat.s.tracks.put('spotify:a', mkTrack(1, { id: 'spotify:a' }));                                                                 // never matched
    await cat.s.tracks.put('spotify:b', mkTrack(2, { id: 'spotify:b' })); await cat.putMatch(rec('spotify:b', cand({ download: { permitted: true, verified: false, reason: 'x', url: 'https://x' } })), 'matched', null);      // unverified
    await cat.s.tracks.put('spotify:c', mkTrack(3, { id: 'spotify:c' })); await cat.putMatch(rec('spotify:c', cand({ download: { permitted: false, verified: true, reason: 'No explicit open license' } })), 'matched', null);
    await cat.s.tracks.put('spotify:d', mkTrack(4, { id: 'spotify:d' })); await cat.putMatch(rec('spotify:d', cand({ download: { permitted: true, verified: true, reason: 'ok' } })), 'matched', null);                         // no url
    await cat.s.tracks.put('spotify:e', mkTrack(5, { id: 'spotify:e', matching_status: 'downloaded' }));
    const r = await mgr.enqueue(['spotify:a', 'spotify:b', 'spotify:c', 'spotify:d', 'spotify:e', 'spotify:ghost']);
    expect(r.queued).toEqual([]); expect(r.skipped.map(s => s.reason)).toEqual([expect.stringMatching(/confirmed match/), expect.stringMatching(/not permitted/), expect.stringMatching(/not permitted: No explicit open license/), expect.stringMatching(/not permitted/), 'Already downloaded', 'Unknown song']);
    expect(tr.starts).toBe(0);
  });
  it('a manual-review match needs the user\'s own confirmation', async () => {
    await cat.s.tracks.put('spotify:r', mkTrack(1, { id: 'spotify:r' })); await cat.putMatch(rec('spotify:r', cand({ band: 'review', confidence: 70 }), 'auto'), 'matched', null);
    expect((await mgr.enqueue(['spotify:r'])).skipped[0].reason).toMatch(/needs your confirmation/);
    await cat.putMatch(rec('spotify:r', cand({ band: 'review', confidence: 70 }), 'user'), 'matched', null); expect((await mgr.enqueue(['spotify:r'])).queued.length).toBe(1);
  });
  it('detects a copy already in the library; an on-device match is never downloaded', async () => {
    await setup(1); local.push({ id: 'lo-1', title: 'Tum Hi Ho (Official Video)', artist: 'Arijit Singh', art: '', url: 'content://m/1', source: 'local' }); expect((await mgr.enqueue(['spotify:t0'])).skipped[0].reason).toMatch(/already in your library/);
    local.length = 0; await cat.putMatch(rec('spotify:t0', cand({ download: { permitted: true, verified: true, local: true, reason: 'on device' } })), 'downloaded', 'lo-ms-5'); expect((await mgr.enqueue(['spotify:t0'])).skipped.length).toBe(1);
  });
  it('the same song cannot be queued twice', async () => { await setup(1); tr.behaviour.set('spotify:t0', hang(tr)); await mgr.enqueue(['spotify:t0']); await settle(); expect((await mgr.enqueue(['spotify:t0'])).skipped[0].reason).toBe('Already in the queue'); });
  it('nothing downloads on its own: matching alone never starts a job (auto is only a setting)', async () => { await setup(3); await settle(); expect(tr.starts).toBe(0); expect(await mgr.jobs()).toEqual([]); });
});

describe('download lifecycle', () => {
  it('downloads, verifies, registers the file in the library, links the song and marks it downloaded', async () => {
    await setup(1); await mgr.enqueue(['spotify:t0']); await settle();
    const [j] = await mgr.jobs(); expect(j).toMatchObject({ state: 'done', bytes: 4 * MB, result: { id: 'lo-spotify:t0', url: 'content://media/spotify:t0' } });
    expect(local).toEqual([expect.objectContaining({ id: 'lo-spotify:t0', title: 'Tum Hi Ho', artist: 'Arijit Singh', album: 'Aashiqui 2', source: 'local', size: 4 * MB, folder: 'Music/Swarify/x', url: 'content://media/spotify:t0' })]);
    expect(await cat.s.tracks.get('spotify:t0')).toMatchObject({ matching_status: 'downloaded', local_file_id: 'lo-spotify:t0' });
  });
  it('runs at most 2 at a time and finishes the rest', async () => {
    await setup(4); let active = 0, peak = 0;
    for (let i = 0; i < 4; i++) tr.behaviour.set(`spotify:t${i}`, async job => { active++; peak = Math.max(peak, active); await settle(15); active--; return { id: `lo-${job.id}`, url: `c://${job.id}`, size: 4 * MB }; });
    await mgr.enqueue([0, 1, 2, 3].map(i => `spotify:t${i}`)); await settle(120); expect(peak).toBe(2); expect((await mgr.jobs()).every(j => j.state === 'done')).toBe(true);
  });
  it('pause keeps the partial data and resume continues; cancel discards it and restores the song', async () => {
    await setup(2); tr.behaviour.set('spotify:t0', hang(tr)); tr.behaviour.set('spotify:t1', hang(tr)); await mgr.enqueue(['spotify:t0', 'spotify:t1']); await settle();
    await mgr.pause('spotify:t0'); await settle(); expect((await cat.s.downloads.get('spotify:t0'))!.state).toBe('paused'); expect(tr.partialKept.has('spotify:t0')).toBe(true);
    tr.behaviour.delete('spotify:t0'); await mgr.resume('spotify:t0'); await settle(); expect((await cat.s.downloads.get('spotify:t0'))!.state).toBe('done');
    await mgr.cancel('spotify:t1'); await settle(); expect((await cat.s.downloads.get('spotify:t1'))!.state).toBe('cancelled'); expect(tr.partialKept.has('spotify:t1')).toBe(false);
    expect((await cat.s.tracks.get('spotify:t1'))!.matching_status).toBe('download_permitted'); expect(local.length).toBe(1);
  });
  it('transient network errors retry with backoff then succeed; persistent ones fail with the error kept', async () => {
    await setup(2); let n = 0; tr.behaviour.set('spotify:t0', async job => { if (++n < 3) throw new TransportError('Connection lost', 'network'); return { id: 'lo-x', url: 'c://x', size: 4 * MB }; });
    tr.behaviour.set('spotify:t1', async () => { throw new TransportError('Connection lost', 'network'); });
    await mgr.enqueue(['spotify:t0', 'spotify:t1']); await settle(60);
    expect((await cat.s.downloads.get('spotify:t0'))).toMatchObject({ state: 'done', attempts: 3 }); const f = (await cat.s.downloads.get('spotify:t1'))!; expect(f).toMatchObject({ state: 'failed', attempts: 3 }); expect(f.error).toMatch(/Connection lost/);
    expect((await cat.s.tracks.get('spotify:t1'))!.matching_status).toBe('failed');
    tr.behaviour.delete('spotify:t1'); await mgr.retry('spotify:t1'); await settle(); expect((await cat.s.downloads.get('spotify:t1'))!.state).toBe('done');      // manual retry resets attempts
  });
  it('HTTP 404/403 and integrity failures are NOT retried', async () => {
    await setup(3); tr.behaviour.set('spotify:t0', async () => { throw new TransportError('Server refused', 'http', 404); }); tr.behaviour.set('spotify:t1', async () => { throw new TransportError('bad header', 'integrity'); }); tr.behaviour.set('spotify:t2', async () => { throw new TransportError('Server error', 'http', 503); });
    await mgr.enqueue(['spotify:t0', 'spotify:t1', 'spotify:t2']); await settle(80); const j = new Map((await mgr.jobs()).map(x => [x.id, x]));
    expect(j.get('spotify:t0')).toMatchObject({ state: 'failed', attempts: 1 }); expect(j.get('spotify:t0')!.error).toMatch(/404/); expect(j.get('spotify:t1')).toMatchObject({ state: 'failed', attempts: 1 }); expect(j.get('spotify:t2')).toMatchObject({ state: 'failed', attempts: 3 });
  });
  it('file integrity: a tiny file (error page) or a size mismatch is rejected, discarded and never registered', async () => {
    await setup(2); tr.behaviour.set('spotify:t0', async () => ({ id: 'lo-a', url: 'c://a', size: 800 })); tr.behaviour.set('spotify:t1', async () => ({ id: 'lo-b', url: 'c://b', size: 2 * MB }));
    await mgr.enqueue(['spotify:t0', 'spotify:t1']); await settle(40); const j = new Map((await mgr.jobs()).map(x => [x.id, x]));
    expect(j.get('spotify:t0')!.error).toMatch(/not audio/); expect(j.get('spotify:t1')!.error).toMatch(/Size mismatch/); expect(tr.discarded.sort()).toEqual(['spotify:t0', 'spotify:t1']); expect(local).toEqual([]);
    expect((await cat.s.tracks.get('spotify:t0'))!.matching_status).toBe('failed');
  });
  it('after an app restart, mid-flight (approved) jobs resume automatically', async () => {
    await setup(1); const j = { id: 'spotify:t0', candidate_key: 'jamendo:0', source: 'jamendo', url: 'https://dl/0.mp3', ext: 'mp3', title: 'Tum Hi Ho', artist: 'A', album: '', art: '', duration_ms: 1, state: 'downloading' as const, bytes: 1, total: 4 * MB, attempts: 1, created_at: 1, updated_at: 1, expected_bytes: 4 * MB };
    await cat.s.downloads.put(j.id, j); await mgr.recover(); await settle(); expect((await cat.s.downloads.get(j.id))!.state).toBe('done');
  });
});

describe('Wi-Fi only, storage allowance and free space', () => {
  it('waits for Wi-Fi on a metered connection, then continues when Wi-Fi returns', async () => {
    await setup(1); tr.unmetered = false; await mgr.enqueue(['spotify:t0']); await settle(); expect((await cat.s.downloads.get('spotify:t0'))!.state).toBe('waiting_wifi'); expect(tr.starts).toBe(0);
    tr.unmetered = true; await mgr.tick(); await settle(); expect((await cat.s.downloads.get('spotify:t0'))!.state).toBe('done');
  });
  it('with Wi-Fi-only off, metered networks are allowed', async () => { await setup(1); settings.wifiOnly = false; tr.unmetered = false; await mgr.enqueue(['spotify:t0']); await settle(); expect((await cat.s.downloads.get('spotify:t0'))!.state).toBe('done'); });
  it('unknown connectivity does not block downloads', async () => { await setup(1); tr.unmetered = null; await mgr.enqueue(['spotify:t0']); await settle(); expect((await cat.s.downloads.get('spotify:t0'))!.state).toBe('done'); });
  it('enforces the maximum storage allocation (counts finished + queued)', async () => {
    await setup(4); settings.maxStorageMB = 9; const r = await mgr.enqueue([0, 1, 2, 3].map(i => `spotify:t${i}`)); await settle(40);
    expect(r.queued.length).toBe(2); expect(r.skipped.length).toBe(2); expect(r.skipped[0].reason).toMatch(/Storage allowance reached/);
  });
  it('refuses when the device lacks free space', async () => { await setup(1); tr.free = 20 * MB; expect((await mgr.enqueue(['spotify:t0'])).skipped[0].reason).toBe('Not enough free space on the device'); });
  it('pause all / resume all', async () => {
    await setup(3); for (let i = 0; i < 3; i++) tr.behaviour.set(`spotify:t${i}`, hang(tr)); await mgr.enqueue(['spotify:t0', 'spotify:t1', 'spotify:t2']); await settle(); await mgr.pauseAll(); await settle();
    expect((await mgr.jobs()).map(j => j.state)).toEqual(['paused', 'paused', 'paused']); for (let i = 0; i < 3; i++) tr.behaviour.delete(`spotify:t${i}`); await mgr.resumeAll(); await settle(60); expect((await mgr.jobs()).every(j => j.state === 'done')).toBe(true);
  });
  it('clear finished removes only completed/cancelled jobs', async () => { await setup(2); tr.behaviour.set('spotify:t1', hang(tr)); await mgr.enqueue(['spotify:t0', 'spotify:t1']); await settle(); await mgr.clearFinished(); expect((await mgr.jobs()).map(j => j.id)).toEqual(['spotify:t1']); });
});

// ---------- mirrored Swarify playlists ----------
import { buildMirror, mergeMirror, MIRROR_PREFIX } from '../src/lib/collector/mirror';
describe('automatic Swarify playlists from imported playlists', () => {
  const mk = (n: string, o: Partial<{ artist: string }> = {}) => ({ source_track_id: n, song_title: n, artist_name: o.artist ?? 'A', album_name: 'Alb', artwork_url: `https://art/${n}.jpg`, duration_ms: 200000, source_url: '', import_status: 'imported' as const });
  it('keeps name, artwork, source, original order and EVERY entry; downloaded songs link to their local file, others are greyed placeholders with a reason', async () => {
    const c = new Catalogue(memoryStores());
    await c.importPlaylist('csv', 'local', { source_playlist_id: 'file-x', kind: 'playlist', name: 'swarify_90s_test_fixed', artwork_url: '', owner: '', total: 4, snapshot_id: null }, ['one', 'two', 'three', 'four'].map(n => mk(n)), 5);
    await c.markDownloaded('csv:two', 'lo-ms-9'); await c.setStatus('csv:three', 'no_match'); await c.setStatus('csv:four', 'download_permitted');
    const file: Track = { id: 'lo-ms-9', title: 'Two (file)', artist: 'A', art: '', url: 'content://media/9', source: 'local', size: 5 * MB };
    const [pl] = buildMirror(await c.playlists(), await c.tracks(), [file]);
    expect(pl).toMatchObject({ id: `${MIRROR_PREFIX}csv:file-x`, name: 'Swarify 90s', source: { platform: 'csv', total: 4, importedAt: 5 } });
    expect(pl.tracks.map(t => t.title)).toEqual(['one', 'Two (file)', 'three', 'four']);               // order preserved, nothing dropped
    expect(pl.tracks.map(t => !!t.url)).toEqual([false, true, false, false]); expect(pl.tracks[1].art).toBe('https://art/two.jpg');
    expect(pl.tracks.filter(t => t.unavailable).map(t => t.unavailable)).toEqual(['Not matched yet', 'Not available as a free download', 'Ready to download']);
  });
  it('removed-at-source entries are not mirrored; non-songs are labelled; user playlists are never touched by a re-mirror', async () => {
    const c = new Catalogue(memoryStores()); await c.importPlaylist('youtube', 'u', { source_playlist_id: 'p', kind: 'playlist', name: 'P', artwork_url: '', owner: '', total: 2, snapshot_id: null }, [mk('a'), { ...mk('pod'), import_status: 'not_music' as const }], 1);
    const m1 = buildMirror(await c.playlists(), await c.tracks(), []); expect(m1[0].tracks.map(t => t.unavailable)).toEqual(['Not matched yet', 'Not a song']);
    const mine = { id: 'my1', name: 'Mine', tracks: [] as Track[] }; const merged = mergeMirror([mine, { id: `${MIRROR_PREFIX}old`, name: 'stale', tracks: [] }], m1);
    expect(merged.map(p => p.id)).toEqual(['my1', `${MIRROR_PREFIX}youtube:p`]);
  });
});
