import { beforeEach, describe, expect, it } from 'vitest';
import { Catalogue, memoryStores } from '../src/lib/collector/catalogue';
import { parseCsv, parseCsvPlaylist } from '../src/lib/collector/csv';
import { GoogleAuth, GoogleAuthError, GoogleReauthRequired } from '../src/lib/collector/google/auth';
import { friendlyYt, importCsvFiles, importYouTube } from '../src/lib/collector/importer';
import { MemorySecureStore } from '../src/lib/collector/secure';
import { classifyVideo, isoDurationSeconds, parseTitle } from '../src/lib/collector/youtube/classify';
import { YouTubeApiError, YouTubeClient } from '../src/lib/collector/youtube/client';
import { FakeGoogle, type FakeVideo } from './fakeGoogle';

let g: FakeGoogle, store: MemorySecureStore, auth: GoogleAuth, yt: YouTubeClient, cat: Catalogue, now: number, sleeps: number[];
const song = (i: number, o: Partial<FakeVideo> = {}): FakeVideo => ({ id: `v${i}`, title: `Song ${i} (Official Video)`, channel: 'T-Series', cat: '10', dur: 'PT4M5S', ...o });
const connect = async () => { await auth.setCredentials(g.clientId, g.clientSecret); const dc = await auth.startDeviceFlow(); g.approved = true; await auth.pollDeviceFlow(dc); };
beforeEach(async () => {
  g = new FakeGoogle(); store = new MemorySecureStore(); now = 1_700_000_000_000; sleeps = []; cat = new Catalogue(memoryStores());
  auth = new GoogleAuth({ fetch: g.fetch as typeof fetch, store, now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; } });
  yt = new YouTubeClient({ fetch: g.fetch as typeof fetch, auth, sleep: async ms => { sleeps.push(ms); } });
});

describe('Google OAuth (device flow)', () => {
  it('needs credentials first; reports a bad client id clearly', async () => {
    await expect(auth.startDeviceFlow()).rejects.toThrow(GoogleAuthError);
    await auth.setCredentials('wrong', 'x'); await expect(auth.startDeviceFlow()).rejects.toThrow(/TVs and Limited Input/);
  });
  it('requests only the read-only YouTube scope and shows a user code', async () => {
    await auth.setCredentials(g.clientId, g.clientSecret); const dc = await auth.startDeviceFlow();
    expect(dc.user_code).toBe('ABCD-EFGH'); expect(dc.verification_url).toBe('https://www.google.com/device');
    expect(new URLSearchParams(g.calls[0].body).get('scope')).toBe('https://www.googleapis.com/auth/youtube.readonly');
  });
  it('polls through authorization_pending, honours slow_down (+5 s), then stores tokens', async () => {
    g.slowDownOnce = true; await connect();
    expect(sleeps.slice(0, 3)).toEqual([5000, 10000, 10000]); expect((await auth.tokens())!.access_token).toBe('YA1'); expect(await auth.isConnected()).toBe(true);
    expect(g.polls).toBeGreaterThanOrEqual(4);
  });
  it('stops on denial, expiry and cancellation', async () => {
    await auth.setCredentials(g.clientId, g.clientSecret);
    g.denied = true; await expect(auth.pollDeviceFlow(await auth.startDeviceFlow())).rejects.toThrow(/denied/); g.denied = false;
    g.expiredToken = true; await expect(auth.pollDeviceFlow(await auth.startDeviceFlow())).rejects.toThrow(/expired/); g.expiredToken = false;
    const ac = new AbortController(); ac.abort(); await expect(auth.pollDeviceFlow(await auth.startDeviceFlow(), ac.signal)).rejects.toThrow(/cancelled/);
    expect(await auth.isConnected()).toBe(false);
  });
  it('code that nobody approves eventually expires', async () => {
    await auth.setCredentials(g.clientId, g.clientSecret); g.pendingPolls = 1e9; g.approved = true;
    await expect(auth.pollDeviceFlow(await auth.startDeviceFlow())).rejects.toThrow(/expired/);
  });
  it('refreshes near expiry (sharing one refresh) and keeps the refresh token', async () => {
    await connect(); now += 3600_000 - 30_000;
    const r = await Promise.all([auth.accessToken(), auth.accessToken()]); expect(new Set(r).size).toBe(1); expect(r[0]).toBe('YA2');
    expect(g.calls.filter(c => /refresh_token/.test(c.body ?? '')).length).toBe(1); expect((await auth.tokens())!.refresh_token).toBe('YR1');
  });
  it('revoked/expired refresh token → reauth required, tokens cleared (Testing-mode 7-day expiry)', async () => {
    await connect(); g.revokedGrant = true; now += 3600_000;
    await expect(auth.accessToken()).rejects.toBeInstanceOf(GoogleReauthRequired); expect(await auth.isConnected()).toBe(false);
  });
  it('disconnect revokes the grant at Google and clears local tokens', async () => {
    await connect(); expect(await auth.revoke()).toBe(true); expect(g.revoked).toEqual(['YR1']); expect(await auth.isConnected()).toBe(false);
  });
  it('disconnect still clears locally when Google is unreachable', async () => {
    await connect(); const f = async () => { throw new Error('offline'); }; const a2 = new GoogleAuth({ fetch: f as typeof fetch, store, now: () => now });
    expect(await a2.revoke()).toBe(false); expect(await a2.isConnected()).toBe(false);
  });
});

describe('YouTube import', () => {
  it('imports playlists with names, artwork, order, and parsed title/artist/movie', async () => {
    await connect();
    g.playlists = [{ id: 'PL1', title: 'Bollywood Hits', videos: [{ id: 'a', title: 'Tum Hi Ho Full Video Song | Aashiqui 2 | Aditya Roy Kapur', channel: 'T-Series', cat: '10', dur: 'PT4M22S' }, { id: 'b', title: 'Arijit Singh - Kesariya (From "Brahmastra") [Official Video]', channel: 'Sony Music India', cat: '10' }] }];
    const rec = await importYouTube(yt, cat, { liked: false, now: () => now });
    expect(rec.ok).toBe(true); expect(rec.playlists).toBe(1);
    const t = await cat.playlistTracks('youtube:PL1'); expect(t.map(x => x.source_track_id)).toEqual(['a', 'b']);
    expect(t[0]).toMatchObject({ song_title: 'Tum Hi Ho', album_name: 'Aashiqui 2', import_status: 'imported', matching_status: 'pending_match', duration_ms: 262000, source_platform: 'youtube', channel: 'T-Series' });
    expect(t[1]).toMatchObject({ song_title: 'Kesariya', artist_name: 'Arijit Singh', album_name: 'Brahmastra' });
    expect(t[0].source_url).toBe('https://www.youtube.com/watch?v=a'); expect(t[0].artwork_url).toContain('hqdefault');
  });
  it('follows pagination for playlists, items and liked videos; batches video lookups at 50', async () => {
    await connect(); g.pageSize = 7;
    g.playlists = Array.from({ length: 12 }, (_, i) => ({ id: `P${i}`, title: `PL ${i}`, videos: Array.from({ length: i === 4 ? 120 : 2 }, (_, k) => song(i * 1000 + k)) }));
    g.liked = Array.from({ length: 33 }, (_, i) => song(90000 + i));
    const rec = await importYouTube(yt, cat, {});
    expect(rec.playlists).toBe(13); expect((await cat.playlistTracks('youtube:P4')).length).toBe(120);
    expect((await cat.playlistTracks('youtube:liked')).length).toBe(33);
    expect(g.calls.filter(c => c.url.includes('/videos?') && c.url.includes('id=v4')).length).toBeGreaterThanOrEqual(3);   // 120 ids → ≥3 detail requests
  });
  it('liked videos come from myRating=like, name the list, and keep order', async () => {
    await connect(); g.liked = [song(1), song(2), song(3)]; const rec = await importYouTube(yt, cat, { playlists: false });
    expect(rec.tracks_added).toBe(3); const liked = (await cat.playlists('youtube'))[0]; expect(liked).toMatchObject({ kind: 'liked', name: 'Liked videos' });
    expect(g.calls.some(c => c.url.includes('myRating=like'))).toBe(true); expect((await cat.playlistTracks(liked.id)).map(t => t.source_track_id)).toEqual(['v1', 'v2', 'v3']);
  });
  it('deleted and private videos stay in place, marked unavailable (not dropped, not treated as songs)', async () => {
    await connect(); g.playlists = [{ id: 'P', title: 'Mixed', videos: [song(1), { missing: 'private', id: 'pv' }, song(3), { missing: 'deleted', id: 'dv' }, song(5, { privacy: 'private' })] }];
    await importYouTube(yt, cat, { liked: false }); const t = await cat.playlistTracks('youtube:P');
    expect(t.map(x => x.import_status)).toEqual(['imported', 'unavailable', 'imported', 'unavailable', 'unavailable']);
    expect(t[1].song_title).toBe('Private video'); expect(t[3].song_title).toBe('Deleted video'); expect(t.every(x => x.matching_status === 'unavailable' || x.import_status === 'imported')).toBe(true);
  });
  it('does not treat every video as a song; the user can override and the override survives re-import', async () => {
    await connect();
    g.playlists = [{ id: 'P', title: 'Watch later', videos: [song(1), { id: 'pod', title: 'Joe Interview Podcast Episode 45', channel: 'Some Podcast', cat: '22', dur: 'PT2H10M' }, { id: 'jb', title: 'Top 50 Bollywood Songs Jukebox', channel: 'T-Series', cat: '10', dur: 'PT3H' }] }];
    await importYouTube(yt, cat, { liked: false }); let t = await cat.playlistTracks('youtube:P');
    expect(t.map(x => x.import_status)).toEqual(['imported', 'not_music', 'not_music']); expect(t[1].matching_status).toBe('unavailable'); expect(t[1].music_confidence).toBeLessThan(0.5);
    await cat.setMusicOverride('youtube:jb', true); await importYouTube(yt, cat, { liked: false }); t = await cat.playlistTracks('youtube:P');
    expect(t[2]).toMatchObject({ import_status: 'imported', matching_status: 'pending_match', user_override: true });
  });
  it('same video in two playlists is stored once; ordering follows playlist position', async () => {
    await connect(); const shared = song(7); g.playlists = [{ id: 'A', title: 'A', videos: [song(1), shared] }, { id: 'B', title: 'B', videos: [shared, song(2)] }]; g.liked = [shared];
    await importYouTube(yt, cat, {}); expect((await cat.tracks('youtube')).length).toBe(3); expect((await cat.playlistsOf('youtube:v7')).map(p => p.name).sort()).toEqual(['A', 'B', 'Liked videos']);
    expect((await cat.playlistTracks('youtube:B')).map(t => t.source_track_id)).toEqual(['v7', 'v2']);
  });
  it('one inaccessible playlist does not stop the rest; reason recorded', async () => {
    await connect(); g.playlists = [{ id: 'P1', title: 'OK', videos: [song(1)] }, { id: 'forbidden1', title: 'Private one', videos: [] }, { id: 'P2', title: 'OK2', videos: [song(2)] }];
    const rec = await importYouTube(yt, cat, { liked: false }); expect(rec.playlists).toBe(2); expect(rec.errors[0]).toMatch(/Private one.*private or not accessible/);
    expect((await cat.s.playlists.get('youtube:forbidden1'))!.last_error).toMatch(/private/);
  });
  it('maps quota / API-not-enabled / rate limits to actionable messages', async () => {
    await connect(); g.failNext = { status: 403, reason: 'quotaExceeded', times: 99 }; await expect(yt.playlists()).rejects.toMatchObject({ reason: 'quotaExceeded' });
    expect(friendlyYt(new YouTubeApiError(403, 'quotaExceeded', 'x'))).toMatch(/quota/); expect(friendlyYt(new YouTubeApiError(403, 'accessNotConfigured', 'x'))).toMatch(/not enabled/);
    g.failNext = { status: 403, reason: 'accessNotConfigured', times: 99 };
    await expect(importYouTube(yt, cat, {})).rejects.toMatchObject({ message: expect.stringMatching(/YouTube Data API v3.*test user/s) });
  });
  it('retries 5xx / 429 with backoff', async () => { await connect(); g.playlists = [{ id: 'P', title: 'P', videos: [] }]; g.failNext = { status: 503, reason: 'backendError', times: 2 }; expect((await yt.playlists()).length).toBe(1); expect(sleeps.slice(-2)).toEqual([500, 1000]); });
  it('401 → refresh once → success; revoked grant mid-import → reauth, data kept', async () => {
    await connect(); g.playlists = [{ id: 'P', title: 'P', videos: [song(1)] }]; await importYouTube(yt, cat, { liked: false });
    g.accessToken = 'ROTATED'; await expect(yt.me()).resolves.toMatchObject({ id: 'UC123' });
    g.accessToken = 'ROTATED2'; g.revokedGrant = true; await expect(importYouTube(yt, cat, { liked: false })).rejects.toBeInstanceOf(GoogleReauthRequired);
    expect((await cat.syncs())[0]).toMatchObject({ ok: false, platform: 'youtube' }); expect((await cat.tracks()).length).toBe(1); expect(await auth.isConnected()).toBe(false);
  });
  it('records last-synced and respects "sync selected"', async () => {
    await connect(); g.playlists = [{ id: 'A', title: 'A', videos: [song(1)] }, { id: 'B', title: 'B', videos: [song(2)] }];
    await importYouTube(yt, cat, { liked: false, now: () => now }); expect((await cat.account('youtube'))!.last_synced_at).toBe(now);
    await cat.setSelected('youtube:B', false); g.calls.length = 0; await importYouTube(yt, cat, { liked: false, onlySelected: true });
    expect(g.calls.some(c => c.url.includes('playlistId=B'))).toBe(false); expect(g.calls.some(c => c.url.includes('playlistId=A'))).toBe(true);
  });
});

describe('music identification & title parsing', () => {
  const C = (title: string, channel: string, cat?: string, dur?: number) => classifyVideo({ title, channel, categoryId: cat, durationSec: dur });
  it('recognises typical Bollywood / pop uploads', () => {
    expect(C('Tum Hi Ho Full Video Song | Aashiqui 2 | Aditya Roy Kapur', 'T-Series', '10', 262).isMusic).toBe(true);
    expect(C('Channa Mereya', 'Arijit Singh - Topic', '10', 289).isMusic).toBe(true);
    expect(C('Arijit Singh - Kesariya (Official Video)', 'Sony Music India', undefined, 270).isMusic).toBe(true);
    expect(C('Apna Bana Le | Official Lyric Video', 'Sachin-Jigar', '10', 240).isMusic).toBe(true);
  });
  it('rejects talks, trailers, tutorials and compilations', () => {
    for (const [t, ch, cat, d] of [['Joe Rogan Experience #2000 - Elon Musk Interview', 'PowerfulJRE', '22', 10800], ['Brahmastra Official Trailer', 'Star Studios', '1', 160], ['How to play Tum Hi Ho on guitar - tutorial', 'Guitar Class', '27', 600], ['Top 50 Bollywood Songs Jukebox', 'T-Series', '10', 12000], ['Minecraft gameplay walkthrough part 3', 'Gamer', '20', 1800]] as const)
      expect(C(t, ch, cat, d).isMusic, t).toBe(false);
  });
  it('exposes reasons and a 0..1 confidence', () => { const r = C('Channa Mereya', 'Arijit Singh - Topic', '10', 289); expect(r.confidence).toBeGreaterThanOrEqual(0.9); expect(r.confidence).toBeLessThanOrEqual(1); expect(r.reasons.join()).toMatch(/Topic/); });
  it('parseTitle: movie, artist, trailing words', () => {
    expect(parseTitle('Tum Hi Ho Full Video Song | Aashiqui 2 | Aditya Roy Kapur', 'T-Series')).toEqual({ title: 'Tum Hi Ho', artist: '', album: 'Aashiqui 2' });
    expect(parseTitle('Arijit Singh - Kesariya (From "Brahmastra") [Official Video]', 'Sony')).toMatchObject({ title: 'Kesariya', artist: 'Arijit Singh', album: 'Brahmastra' });
    expect(parseTitle('Gerua (Lyrical) | Dilwale', 'Pritam Official')).toMatchObject({ title: 'Gerua', album: 'Dilwale' });
    expect(parseTitle('Raabta', 'Arijit Singh - Topic').artist).toBe('Arijit Singh');
  });
  it('isoDurationSeconds', () => { expect(isoDurationSeconds('PT4M5S')).toBe(245); expect(isoDurationSeconds('PT1H2M3S')).toBe(3723); expect(isoDurationSeconds('P0D')).toBe(0); expect(isoDurationSeconds(undefined)).toBe(0); });
});

describe('CSV import', () => {
  const exportify = 'Track URI,Track Name,Album Name,Artist Name(s),Release Date,Duration (ms),Added At,Album Image URL\r\n"spotify:track:4cOdK2wGLETKBW3PvgPWqT","Tum Hi Ho, Remastered","Aashiqui 2","Arijit Singh;Mithoon",2013,262000,2020-01-01T00:00:00Z,https://i.scdn.co/a.jpg\r\nspotify:track:1111111111111111111111,Kesariya,Brahmastra,Arijit Singh,2022,268000,,\r\n,"Song with ""quotes""",Album,Artist,2020,not-a-number,,\r\n,,,,,,,\r\n';
  it('parses quotes, commas, CRLF and BOM', () => { const r = parseCsv('﻿a,b\r\n"x,1","y ""q"""\r\n'); expect(r).toEqual([['a', 'b'], ['x,1', 'y "q"']]); });
  it('maps Exportify-style columns; Spotify URIs keep their ID', () => {
    const r = parseCsvPlaylist('Road_Trip.csv', exportify);
    expect(r.playlistName).toBe('Road Trip'); expect(r.items.length).toBe(3);
    expect(r.items[0]).toMatchObject({ platform: 'spotify', source_track_id: '4cOdK2wGLETKBW3PvgPWqT', song_title: 'Tum Hi Ho, Remastered', artist_name: 'Arijit Singh, Mithoon', album_name: 'Aashiqui 2', duration_ms: 262000, artwork_url: 'https://i.scdn.co/a.jpg' });
    expect(r.items[2]).toMatchObject({ platform: 'csv', song_title: 'Song with "quotes"', duration_ms: 0 });
  });
  it('rejects files without a title column, and skips empty rows', () => { expect(parseCsvPlaylist('x.csv', 'foo,bar\r\n1,2').error).toMatch(/song-title/); expect(parseCsvPlaylist('x.csv', 'a').error).toMatch(/no rows/); });
  it('imports into the same catalogue, keeping order, and dedupes with API-imported Spotify songs', async () => {
    const pre = new Catalogue(memoryStores());
    await pre.importPlaylist('spotify', 'u', { source_playlist_id: 'p', kind: 'playlist', name: 'API', artwork_url: '', owner: 'u', total: 1, snapshot_id: null }, [{ source_track_id: '4cOdK2wGLETKBW3PvgPWqT', song_title: 'Tum Hi Ho', artist_name: 'Arijit Singh', album_name: 'Aashiqui 2', artwork_url: '', duration_ms: 262000, source_url: '', import_status: 'imported' }]);
    const rec = await importCsvFiles(pre, [{ name: 'Road_Trip.csv', text: exportify }, { name: 'bad.csv', text: 'x,y\r\n1,2' }], () => 5);
    expect(rec.playlists).toBe(1); expect(rec.errors.join()).toMatch(/bad\.csv.*song-title/); expect(rec.tracks_added).toBe(2);   // 3 rows, one already known from the API import
    expect((await pre.tracks()).length).toBe(3);
    const ids = (await pre.playlistTracks('csv:file-road trip')).map(t => t.id);          // original CSV row order
    expect(ids.slice(0, 2)).toEqual(['spotify:4cOdK2wGLETKBW3PvgPWqT', 'spotify:1111111111111111111111']); expect(ids[2]).toMatch(/^csv:csv-/);
    expect((await pre.playlistsOf('spotify:4cOdK2wGLETKBW3PvgPWqT')).map(p => p.name).sort()).toEqual(['API', 'Road Trip']);
  });
});
