import { beforeEach, describe, expect, it } from 'vitest';
import { Catalogue, memoryStores } from '../src/lib/collector/catalogue';
import { importSpotify } from '../src/lib/collector/importer';
import { MemorySecureStore } from '../src/lib/collector/secure';
import { SpotifyAuth, ReauthRequired } from '../src/lib/collector/spotify/auth';
import { SpotifyApiError, SpotifyClient, mapItems } from '../src/lib/collector/spotify/client';
import { FakeSpotify, makeTracks } from './fakeSpotify';

let api: FakeSpotify, cat: Catalogue, auth: SpotifyAuth, client: SpotifyClient, sleeps: number[], now: number;
const connect = async () => { await auth.setClientId('cid'); const url = await auth.begin(); await auth.complete(`x://cb?code=GOODCODE&state=${new URL(url).searchParams.get('state')}`); };
beforeEach(async () => {
  api = new FakeSpotify(); cat = new Catalogue(memoryStores()); sleeps = []; now = 1_700_000_000_000;
  auth = new SpotifyAuth({ fetch: api.fetch as typeof fetch, store: new MemorySecureStore(), redirectUri: 'x://cb', now: () => now });
  client = new SpotifyClient({ fetch: api.fetch as typeof fetch, auth, sleep: async ms => { sleeps.push(ms); } });
  await connect();
});

describe('playlist import', () => {
  it('imports playlists with names, artwork, order and full track metadata', async () => {
    api.playlists = [{ id: 'p1', name: 'Bollywood Hits', tracks: makeTracks(5) }, { id: 'p2', name: 'Road Trip', tracks: makeTracks(3, 'r') }];
    const rec = await importSpotify(client, cat, { liked: false, now: () => now });
    expect(rec.ok).toBe(true); expect(rec.playlists).toBe(2); expect(rec.tracks_added).toBe(8);
    const pls = await cat.playlists('spotify'); expect(pls.map(p => p.name).sort()).toEqual(['Bollywood Hits', 'Road Trip']);
    const t = (await cat.playlistTracks('spotify:p1'))[0];
    expect(t).toMatchObject({ song_title: 'Song t0', artist_name: 'Arijit Singh, Shreya Ghoshal', album_name: 'Album 0', duration_ms: 200000, source_track_id: 't0', source_platform: 'spotify', matching_status: 'pending_match', local_file_id: null, user_id: 'user123' });
    expect(t.artwork_url).toContain('640'); expect(t.source_url).toContain('open.spotify.com');
  });
  it('preserves original playlist ordering', async () => {
    const ts = makeTracks(10); api.playlists = [{ id: 'p', name: 'Ordered', tracks: [...ts].reverse() }];
    await importSpotify(client, cat, { liked: false });
    expect((await cat.playlistTracks('spotify:p')).map(t => t.source_track_id)).toEqual(ts.map(t => t.id).reverse());
  });
  it('follows pagination across many pages (playlist list and items)', async () => {
    api.pageSize = 7; api.playlists = Array.from({ length: 23 }, (_, i) => ({ id: `p${i}`, name: `PL ${i}`, tracks: makeTracks(i === 3 ? 53 : 2, `p${i}-`) }));
    const rec = await importSpotify(client, cat, { liked: false });
    expect(rec.playlists).toBe(23); expect((await cat.playlistTracks('spotify:p3')).length).toBe(53);
    expect(api.calls.filter(c => c.url.includes('/me/playlists')).length).toBe(Math.ceil(23 / 7));
  });
  it('imports liked songs (saved tracks) as a dedicated list with pagination', async () => {
    api.pageSize = 20; api.saved = makeTracks(75, 's');
    const rec = await importSpotify(client, cat, { playlists: false, liked: true });
    expect(rec.tracks_added).toBe(75); const liked = (await cat.playlists('spotify')).find(p => p.kind === 'liked')!;
    expect(liked.name).toBe('Liked Songs'); expect((await cat.playlistTracks(liked.id)).length).toBe(75);
  });
  it('stores a song once even when it is in several playlists, keeping every playlist relationship', async () => {
    const shared = makeTracks(1, 'shared')[0]; api.playlists = [{ id: 'a', name: 'A', tracks: [shared, ...makeTracks(2, 'a')] }, { id: 'b', name: 'B', tracks: [...makeTracks(2, 'b'), shared] }];
    api.saved = [shared];
    await importSpotify(client, cat, {});
    const all = await cat.tracks('spotify'); expect(all.filter(t => t.source_track_id === 'shared0').length).toBe(1);
    expect(all.length).toBe(5); // shared + 2 in A + 2 in B
    expect((await cat.playlistsOf('spotify:shared0')).map(p => p.name).sort()).toEqual(['A', 'B', 'Liked Songs']);
    expect((await cat.playlistTracks('spotify:b')).map(t => t.source_track_id)).toEqual(['b0', 'b1', 'shared0']);
  });
  it('re-importing creates no duplicates and does not reset matching / download state', async () => {
    api.playlists = [{ id: 'p', name: 'P', tracks: makeTracks(4) }]; await importSpotify(client, cat, { liked: false });
    const tr = (await cat.s.tracks.get('spotify:t1'))!; await cat.s.tracks.put(tr.id, { ...tr, matching_status: 'downloaded', local_file_id: 'lo-ms-9' });
    const rec = await importSpotify(client, cat, { liked: false });
    expect(rec.tracks_added).toBe(0); expect((await cat.tracks()).length).toBe(4);
    expect(await cat.s.tracks.get('spotify:t1')).toMatchObject({ matching_status: 'downloaded', local_file_id: 'lo-ms-9' });
  });
  it('keeps unavailable / local / podcast entries so playlist order is not lost', async () => {
    const items = [{ added_at: 'a', track: makeTracks(1)[0] }, { added_at: 'b', track: null }, { added_at: 'c', is_local: true, track: { id: null, name: 'My rip', artists: [{ name: 'Me' }], duration_ms: 1000 } }, { added_at: 'd', track: { ...makeTracks(1, 'e')[0], type: 'episode' } }];
    const m = mapItems(items as never); expect(m.map(x => x.import_status)).toEqual(['imported', 'unavailable', 'unavailable', 'unavailable']);
    api.playlists = [{ id: 'p', name: 'Mixed', tracks: [makeTracks(1)[0], makeTracks(1, 'z')[0]] }]; await importSpotify(client, cat, { liked: false });
    expect((await cat.playlistTracks('spotify:p')).length).toBe(2);
  });
  it('one failing playlist does not stop the others; failure is recorded', async () => {
    api.playlists = [{ id: 'ok1', name: 'OK1', tracks: makeTracks(2) }, { id: 'bad', name: 'Restricted', tracks: [], fail: 403 }, { id: 'ok2', name: 'OK2', tracks: makeTracks(2, 'q') }];
    const rec = await importSpotify(client, cat, { liked: false });
    expect(rec.playlists).toBe(2); expect(rec.errors.length).toBe(1); expect(rec.errors[0]).toMatch(/Restricted.*did not allow/); expect(rec.ok).toBe(true);
    expect((await cat.s.playlists.get('spotify:bad'))!.last_error).toMatch(/did not allow/);
    expect((await cat.syncs())[0].errors.length).toBe(1);
  });
  it('falls back to /items if Spotify has moved the playlist tracks path', async () => {
    api.tracksPathMoved = true; api.playlists = [{ id: 'p', name: 'P', tracks: makeTracks(3) }];
    const rec = await importSpotify(client, cat, { liked: false }); expect(rec.tracks_added).toBe(3);
  });
  it('syncs only selected playlists when asked, and keeps new playlists selected by default', async () => {
    api.playlists = [{ id: 'a', name: 'A', tracks: makeTracks(1) }, { id: 'b', name: 'B', tracks: makeTracks(1, 'b') }];
    await importSpotify(client, cat, { liked: false }); await cat.setSelected('spotify:b', false);
    api.playlists.push({ id: 'c', name: 'C', tracks: makeTracks(1, 'c') }); api.calls.length = 0;
    await importSpotify(client, cat, { liked: false, onlySelected: true });
    expect(api.calls.some(c => c.url.includes('/playlists/b/'))).toBe(false); expect(api.calls.some(c => c.url.includes('/playlists/c/'))).toBe(true);
  });
});

describe('API robustness', () => {
  it('honours Retry-After on 429 then succeeds', async () => {
    api.playlists = [{ id: 'p', name: 'P', tracks: makeTracks(1) }]; api.failNext = { status: 429, headers: { 'Retry-After': '3' }, times: 2 };
    expect((await client.playlists()).length).toBe(1); expect(sleeps).toEqual([3000, 3000]);
  });
  it('gives up with a clear error after repeated 429', async () => {
    api.failNext = { status: 429, headers: { 'Retry-After': '1' }, times: 99 }; await expect(client.me()).rejects.toMatchObject({ status: 429 });
  });
  it('retries 5xx with backoff', async () => { api.failNext = { status: 503, times: 2 }; await expect(client.me()).resolves.toMatchObject({ id: 'user123' }); expect(sleeps).toEqual([500, 1000]); });
  it('401 (expired access token) → refreshes once → retries transparently', async () => {
    api.accessToken = 'ROTATED'; // server rotated the token behind our back; client still holds AT1
    const r = await client.me().catch(e => e); expect(r).toMatchObject({ id: 'user123' });
    expect(api.tokenCalls.filter(c => /refresh_token/.test(c.body!)).length).toBe(1);
  });
  it('revoked access mid-import → ReauthRequired, sync recorded as failed, existing data kept', async () => {
    api.playlists = [{ id: 'p', name: 'P', tracks: makeTracks(2) }]; await importSpotify(client, cat, { liked: false });
    api.accessToken = 'NEW'; api.revoked = true;
    await expect(importSpotify(client, cat, { liked: false })).rejects.toBeInstanceOf(ReauthRequired);
    expect((await cat.syncs())[0]).toMatchObject({ ok: false }); expect((await cat.tracks()).length).toBe(2);
    expect(await auth.isConnected()).toBe(false);
  });
  it('non-retryable errors surface as SpotifyApiError with status', async () => { api.failNext = { status: 403, times: 1 }; await expect(client.me()).rejects.toBeInstanceOf(SpotifyApiError); });
});

describe('sync bookkeeping & disconnect', () => {
  it('records last-synced time and keeps entries removed at the source (flagged, never deleted)', async () => {
    api.playlists = [{ id: 'p', name: 'P', tracks: makeTracks(3) }]; await importSpotify(client, cat, { liked: false, now: () => now });
    expect((await cat.account('spotify'))!.last_synced_at).toBe(now);
    api.playlists[0].tracks = makeTracks(3).slice(0, 2); now += 1000; await importSpotify(client, cat, { liked: false, now: () => now });
    expect((await cat.playlistTracks('spotify:p')).length).toBe(2); expect((await cat.s.tracks.get('spotify:t2'))).toBeTruthy();
    expect((await cat.s.playlists.get('spotify:p'))!.entries.filter(e => e.removed_at).length).toBe(1);
  });
  it('disconnect keeps data by default; purge removes metadata but never tracks that have a local file', async () => {
    api.playlists = [{ id: 'p', name: 'P', tracks: makeTracks(2) }]; await importSpotify(client, cat, { liked: false });
    const t = (await cat.s.tracks.get('spotify:t0'))!; await cat.s.tracks.put(t.id, { ...t, local_file_id: 'lo-1', matching_status: 'downloaded' });
    await cat.removeAccount('spotify', false); expect((await cat.tracks()).length).toBe(2); expect(await cat.account('spotify')).toBeUndefined();
    await cat.removeAccount('spotify', true); expect((await cat.tracks()).map(x => x.id)).toEqual(['spotify:t0']); expect((await cat.playlists()).length).toBe(0);
  });
});
