import { beforeEach, describe, expect, it } from 'vitest';
import { Catalogue, memoryStores } from '../src/lib/collector/catalogue';
import { confirmMatch, matchMany, matchTrack, rejectMatch, skipTrack, statusOf } from '../src/lib/collector/match/engine';
import { artistSimilarity, baseTitle, splitArtists, titleSimilarity, versionTags } from '../src/lib/collector/match/normalize';
import { scoreCandidate } from '../src/lib/collector/match/score';
import { ArchiveSource } from '../src/lib/collector/match/sources/archive';
import { JamendoSource } from '../src/lib/collector/match/sources/jamendo';
import { LocalSource } from '../src/lib/collector/match/sources/local';
import { SoundCloudSource } from '../src/lib/collector/match/sources/soundcloud';
import type { Candidate, MatchSource } from '../src/lib/collector/match/types';
import type { ImportedTrack } from '../src/lib/collector/types';
import type { Track } from '../src/lib/types';

const Q = (title: string, artist: string, album = '', dur = 262000) => ({ title, artist, album, duration_ms: dur });
const C = (title: string, artist: string, o: Partial<Candidate> = {}): Candidate => ({ key: `x:${title}|${artist}`, source: 'jamendo', source_id: `${title}|${artist}`, title, artist, album: '', duration_ms: 262000, artwork_url: '', page_url: '', quality: { label: 'mp3', lossless: false }, full_length: true, download: { permitted: true, verified: true, reason: 'test' }, ...o });
const band = (q: ReturnType<typeof Q>, c: Candidate, raw?: string) => scoreCandidate(q, c, raw);

describe('normalisation', () => {
  it('strips decorations and keeps the song name', () => {
    expect(baseTitle('Kesariya (From "Brahmastra")')).toBe('kesariya'); expect(baseTitle('Tum Hi Ho - Remastered 2011')).toBe('tum hi ho'); expect(baseTitle('Channa Mereya [Official Video]')).toBe('channa mereya');
    expect(baseTitle('Café del Mar (feat. X)')).toBe('cafe del mar');
  });
  it('detects different versions but not remasters', () => {
    expect([...versionTags('Tum Hi Ho (Remix)')]).toEqual(['remix']); expect([...versionTags('Channa Mereya - Unplugged')]).toEqual(['acoustic']); expect([...versionTags('Kal Ho Naa Ho (Live at Wembley)')]).toEqual(['live']);
    expect(versionTags('Tum Hi Ho - Remastered 2011').size).toBe(0); expect(versionTags('Tum Hi Ho (Radio Edit)').size).toBe(0);
  });
  it('splits artist credits', () => { expect(splitArtists('Arijit Singh, Shreya Ghoshal & Pritam')).toEqual(['arijit singh', 'shreya ghoshal', 'pritam']); expect(splitArtists('Unknown artist')).toEqual([]); });
  it('similarities', () => {
    expect(titleSimilarity('Tum Hi Ho', 'Tum Hi Ho (From "Aashiqui 2")')).toBe(1); expect(titleSimilarity('Tum Hi Ho', 'Tum Hi Ho Bin Tere')).toBeLessThan(0.9); expect(titleSimilarity('Tum Hi Ho', 'Gerua')).toBeLessThan(0.3);
    expect(artistSimilarity('Arijit Singh', 'Arijit Singh')).toBe(1); expect(artistSimilarity('Arijit Singh, Shreya Ghoshal', 'Arijit Singh')).toBeGreaterThan(0.7); expect(artistSimilarity('Arijit Singh', 'Random Cover Band')).toBeLessThan(0.5); expect(artistSimilarity('', 'X')).toBeNull();
  });
});

describe('matching accuracy (confidence bands)', () => {
  const q = Q('Tum Hi Ho', 'Arijit Singh', 'Aashiqui 2');
  it('exact recording → ≥95, band exact', () => { const s = band(q, C('Tum Hi Ho', 'Arijit Singh', { album: 'Aashiqui 2' })); expect(s.confidence).toBeGreaterThanOrEqual(95); expect(s.band).toBe('exact'); expect(s.flags).toEqual([]); });
  it('same song with "(From …)" decoration and slightly different length is still exact/likely, never lower than likely', () => { const s = band(q, C('Tum Hi Ho (From "Aashiqui 2")', 'Arijit Singh', { duration_ms: 264500 })); expect(s.confidence).toBeGreaterThanOrEqual(90); });
  it.each([
    ['remix', 'Tum Hi Ho (Remix)'], ['live', 'Tum Hi Ho (Live)'], ['cover', 'Tum Hi Ho (Cover)'], ['instrumental', 'Tum Hi Ho (Instrumental)'], ['karaoke', 'Tum Hi Ho (Karaoke Version)'], ['acoustic', 'Tum Hi Ho (Unplugged)'], ['slowed/sped', 'Tum Hi Ho (Slowed + Reverb)'],
  ])('never silently accepts a %s version', (_n, title) => {
    const s = band(q, C(title, 'Arijit Singh')); expect(s.confidence).toBeLessThan(80); expect(s.band).toBe('review'); expect(s.flags.join()).toMatch(/Different version/);
  });
  it('different artist with the same title is never above 79', () => { const s = band(q, C('Tum Hi Ho', 'Some Cover Artist')); expect(s.confidence).toBeLessThan(80); expect(s.flags).toContain('Different artist'); });
  it('big duration mismatch is flagged and capped', () => { const s = band(q, C('Tum Hi Ho', 'Arijit Singh', { duration_ms: 420000 })); expect(s.confidence).toBeLessThan(80); expect(s.flags.join()).toMatch(/Duration differs/); });
  it('preview-only recordings are capped', () => { const s = band(q, C('Tum Hi Ho', 'Arijit Singh', { full_length: false })); expect(s.confidence).toBeLessThan(80); expect(s.flags).toContain('Preview only'); });
  it('unknown original artist (label channel) can be likely but never exact → confirmation needed', () => { const s = band(Q('Tum Hi Ho', '', 'Aashiqui 2'), C('Tum Hi Ho', 'Arijit Singh', { album: 'Aashiqui 2' })); expect(s.confidence).toBeLessThanOrEqual(89); expect(s.confidence).toBeGreaterThanOrEqual(80); expect(s.band).toBe('likely'); expect(s.flags.join()).toMatch(/artist unknown/i); });
  it('an unrelated song scores low', () => { expect(band(q, C('Gerua', 'Arijit Singh', { duration_ms: 290000 })).confidence).toBeLessThan(60); });
  it('if the ORIGINAL is the live/acoustic version, a studio candidate is flagged too', () => { const s = band(Q('Channa Mereya (Unplugged)', 'Arijit Singh'), C('Channa Mereya', 'Arijit Singh'), 'Channa Mereya (Unplugged)'); expect(s.confidence).toBeLessThan(80); expect(s.flags.join()).toMatch(/Original is a acoustic version/); });
  it('matches an unplugged original with an unplugged candidate', () => { const s = band(Q('Channa Mereya (Unplugged)', 'Arijit Singh'), C('Channa Mereya - Unplugged', 'Arijit Singh'), 'Channa Mereya (Unplugged)'); expect(s.confidence).toBeGreaterThanOrEqual(95); });
  it('transliteration/spelling variants still reach likely', () => { expect(band(Q('Kal Ho Naa Ho', 'Sonu Nigam'), C('Kal Ho Na Ho', 'Sonu Nigam')).confidence).toBeGreaterThanOrEqual(80); });
});

// ---------- sources with fake servers (simulated; shapes follow each service's documentation) ----------
const res = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

describe('Jamendo source & download permission', () => {
  const jam = (results: unknown[], seen: string[] = []) => new JamendoSource({ clientId: 'jid', fetch: (async (u: string) => { seen.push(String(u)); return res({ headers: { status: 'success' }, results }); }) as unknown as typeof fetch });
  const t = (o = {}) => ({ id: '1', name: 'Tum Hi Ho', duration: 262, artist_name: 'Arijit Singh', album_name: 'X', audiodownload: 'https://dl/1.mp3', audiodownload_allowed: true, license_ccurl: 'https://creativecommons.org/licenses/by/3.0/', ...o });
  it('permits download only with audiodownload_allowed AND a URL; records the license', async () => {
    const [ok, noFlag, noUrl, explicitNo] = await jam([t(), t({ id: '2', audiodownload_allowed: undefined }), t({ id: '3', audiodownload: '' }), t({ id: '4', audiodownload_allowed: false })]).search(Q('Tum Hi Ho', 'Arijit Singh'));
    expect(ok.download).toMatchObject({ permitted: true, verified: true, url: 'https://dl/1.mp3', license: expect.stringContaining('creativecommons') });
    for (const c of [noFlag, noUrl, explicitNo]) expect(c.download.permitted).toBe(false); expect(explicitNo.download.reason).toMatch(/disabled downloads/);
  });
  it('sends ONLY title and artist (privacy)', async () => {
    const seen: string[] = []; await jam([t()], seen).search({ title: 'Tum Hi Ho', artist: 'Arijit Singh', album: 'Secret Album', duration_ms: 1 });
    const q = new URL(seen[0]).searchParams; expect(q.get('namesearch')).toBe('Tum Hi Ho'); expect(q.get('artist_name')).toBe('Arijit Singh'); expect(seen.join()).not.toMatch(/Secret|album_name/);
  });
  it('falls back to a general search when the precise one is empty; surfaces API errors', async () => {
    let n = 0; const s = new JamendoSource({ clientId: 'x', fetch: (async () => res({ headers: { status: 'success' }, results: n++ ? [t()] : [] })) as unknown as typeof fetch }); expect((await s.search(Q('a', 'b'))).length).toBe(1);
    const bad = new JamendoSource({ clientId: 'x', fetch: (async () => res({ headers: { status: 'failed', error_message: 'invalid client_id' }, results: [] })) as unknown as typeof fetch }); await expect(bad.search(Q('a', 'b'))).rejects.toThrow(/invalid client_id/);
  });
});

describe('Internet Archive source & download permission', () => {
  const ia = (items: Record<string, { md: Record<string, unknown>; files: unknown[]; dark?: boolean }>) => new ArchiveSource({ maxItems: 10, fetch: (async (u: string) => {
    const url = String(u); if (url.includes('advancedsearch')) return res({ response: { docs: Object.keys(items).map(identifier => ({ identifier })) } });
    const id = decodeURIComponent(url.split('/metadata/')[1]); const it = items[id]; return res({ metadata: { identifier: id, ...it.md }, files: it.files, is_dark: it.dark });
  }) as unknown as typeof fetch });
  const mp3 = { name: 'song.mp3', format: 'VBR MP3', size: '5000000', length: '262.1' };
  it('allows only items with an explicit open license that are not restricted', async () => {
    const c = await ia({
      cc: { md: { title: 'Tum Hi Ho', creator: 'Arijit Singh', licenseurl: 'https://creativecommons.org/licenses/by-sa/4.0/' }, files: [mp3] },
      pd: { md: { title: 'Tum Hi Ho', creator: 'A', licenseurl: 'https://creativecommons.org/publicdomain/zero/1.0/' }, files: [mp3] },
      none: { md: { title: 'Tum Hi Ho', creator: 'A' }, files: [mp3] },
      restricted: { md: { title: 'Tum Hi Ho', creator: 'A', licenseurl: 'https://creativecommons.org/licenses/by/4.0/', 'access-restricted-item': 'true' }, files: [mp3] },
      dark: { md: { title: 'Tum Hi Ho', creator: 'A', licenseurl: 'https://creativecommons.org/licenses/by/4.0/' }, files: [mp3], dark: true },
      noaudio: { md: { title: 'Tum Hi Ho', creator: 'A', licenseurl: 'https://creativecommons.org/licenses/by/4.0/' }, files: [{ name: 'x.jpg', format: 'JPEG' }] },
    }).search(Q('Tum Hi Ho', 'Arijit Singh')); const by = Object.fromEntries(c.map(x => [x.source_id, x]));
    expect(by.cc.download).toMatchObject({ permitted: true, url: 'https://archive.org/download/cc/song.mp3', format: 'mp3' }); expect(by.pd.download.permitted).toBe(true);
    expect(by.none.download).toMatchObject({ permitted: false, reason: expect.stringMatching(/No explicit open license/) }); expect(by.restricted.download.reason).toMatch(/restricted/); expect(by.dark.download.permitted).toBe(false); expect(by.noaudio.download.reason).toMatch(/No audio file/);
    expect(by.cc.duration_ms).toBe(262100);
  });
  it('prefers FLAC and marks it lossless', async () => {
    const [c] = await ia({ x: { md: { title: 'T', creator: 'C', licenseurl: 'https://creativecommons.org/licenses/by/4.0/' }, files: [mp3, { name: 'song.flac', format: 'Flac', length: '262' }] } }).search(Q('T', 'C')); expect(c.quality.lossless).toBe(true); expect(c.download.format).toBe('flac');
  });
});

describe('SoundCloud source & download permission', () => {
  const sc = (list: unknown[]) => new SoundCloudSource({ clientId: 'scid', fetch: (async () => res(list)) as unknown as typeof fetch });
  const t = (o = {}) => ({ id: 1, title: 'Tum Hi Ho', duration: 262000, user: { username: 'Arijit Singh' }, downloadable: true, download_url: 'https://api.soundcloud.com/tracks/1/download', access: 'playable', has_downloads_left: true, license: 'cc-by', original_format: 'mp3', ...o });
  it('permits only artist-enabled, full-length, downloads-remaining tracks; streaming alone is not permission', async () => {
    const [ok, stream, preview, limit, nourl] = await sc([t(), t({ id: 2, downloadable: false }), t({ id: 3, access: 'preview' }), t({ id: 4, has_downloads_left: false }), t({ id: 5, download_url: null })]).search(Q('Tum Hi Ho', 'Arijit Singh'));
    expect(ok.download).toMatchObject({ permitted: true, url: expect.stringContaining('client_id=scid') }); expect(stream.download.reason).toMatch(/not enabled downloads/);
    expect(preview.download.permitted).toBe(false); expect(preview.full_length).toBe(false); expect(limit.download.reason).toMatch(/limit/); expect(nourl.download.permitted).toBe(false);
  });
  it('explains restricted API access', async () => { const s = new SoundCloudSource({ clientId: 'x', fetch: (async () => res({}, 401)) as unknown as typeof fetch }); await expect(s.search(Q('a', 'b'))).rejects.toThrow(/restricted/); });
});

describe('local source', () => {
  const local: Track[] = [{ id: 'lo-1', title: 'Tum Hi Ho', artist: 'Arijit Singh', album: 'Aashiqui 2', art: '', url: 'content://media/1', source: 'local', duration: 262 }, { id: 'it-1', title: 'Tum Hi Ho', artist: 'x', art: '', url: 'https://p', source: 'itunes', preview: true }];
  it('only offers files that are really on the device; they are already "downloaded"', async () => {
    const r = await new LocalSource({ tracks: () => local }).search(Q('Tum Hi Ho', 'Arijit Singh')); expect(r.map(c => c.source_id)).toEqual(['lo-1']); expect(r[0].download).toMatchObject({ permitted: true, local: true });
  });
});

// ---------- engine / pipeline ----------
let cat: Catalogue;
const mkTrack = (i: number, o: Partial<ImportedTrack> = {}): ImportedTrack => ({ id: `spotify:t${i}`, user_id: 'u', source_platform: 'spotify', source_track_id: `t${i}`, song_title: i === 0 ? 'Tum Hi Ho' : `Song ${i}`, artist_name: 'Arijit Singh', album_name: 'Aashiqui 2', artwork_url: '', duration_ms: 262000, source_url: '', import_status: 'imported', matching_status: 'pending_match', local_file_id: null, created_at: 1, updated_at: 1, ...o });
const fixed = (id: 'jamendo' | 'archive' | 'local' | 'soundcloud', cands: (t: string) => Candidate[], fail = false): MatchSource => ({ id, name: id, search: async q => { if (fail) throw new Error(`${id} down`); return cands(q.title); } });
beforeEach(async () => { cat = new Catalogue(memoryStores()); for (let i = 0; i < 6; i++) await cat.s.tracks.put(`spotify:t${i}`, mkTrack(i)); });

describe('match pipeline', () => {
  it('exact match with verified download permission → auto-selected, status download_permitted', async () => {
    const t = mkTrack(0); const rec = await matchTrack(t, undefined, { sources: [fixed('jamendo', () => [C('Tum Hi Ho', 'Arijit Singh', { album: 'Aashiqui 2' })])] });
    expect(rec).toMatchObject({ band: 'exact', selected_by: 'auto' }); expect(statusOf(rec)).toBe('download_permitted');
  });
  it('exact match WITHOUT download permission is matched, never download_permitted', async () => {
    const rec = await matchTrack(mkTrack(0), undefined, { sources: [fixed('archive', () => [C('Tum Hi Ho', 'Arijit Singh', { album: 'Aashiqui 2', download: { permitted: false, verified: true, reason: 'no license' } })])] });
    expect(statusOf(rec)).toBe('matched'); expect(rec.candidates[0].download.permitted).toBe(false);
  });
  it('a cover/remix/different artist is NEVER auto-selected; it waits for the user as a possible match', async () => {
    const rec = await matchTrack(mkTrack(0), undefined, { sources: [fixed('jamendo', () => [C('Tum Hi Ho (Cover)', 'Arijit Singh'), C('Tum Hi Ho', 'Other Band'), C('Tum Hi Ho (Remix)', 'Arijit Singh')])] });
    expect(rec.selected).toBeNull(); expect(statusOf(rec)).toBe('possible_match'); expect(rec.candidates.every(c => c.band === 'review')).toBe(true);
  });
  it('likely (80–94) needs confirmation; confirming selects it and sets download_permitted', async () => {
    await cat.s.tracks.put('spotify:t0', mkTrack(0, { artist_name: '' }));
    const t = (await cat.s.tracks.get('spotify:t0'))!; const o = { sources: [fixed('jamendo', () => [C('Tum Hi Ho', 'Arijit Singh', { album: 'Aashiqui 2' })])] };
    const rec = await matchTrack(t, undefined, o); expect(rec.band).toBe('likely'); expect(rec.selected).toBeNull(); await cat.putMatch(rec, statusOf(rec), null);
    expect((await cat.s.tracks.get(t.id))!.matching_status).toBe('possible_match'); await confirmMatch(cat, t.id, rec.candidates[0].key);
    expect((await cat.s.tracks.get(t.id))!.matching_status).toBe('download_permitted'); expect((await cat.getMatch(t.id))).toMatchObject({ selected_by: 'user' });
  });
  it('no candidates → no_match; every source failing → failed (retryable) not no_match', async () => {
    const t = mkTrack(0);
    expect(statusOf(await matchTrack(t, undefined, { sources: [fixed('jamendo', () => [])] }))).toBe('no_match');
    const bad = await matchTrack(t, undefined, { sources: [fixed('jamendo', () => [], true), fixed('archive', () => [], true)] }); expect(bad.errors.length).toBe(2); expect(statusOf(bad)).toBe('failed');
  });
  it('PARTIAL outage with nothing found is "failed" (retryable), never a false "no match"', async () => {
    const rec = await matchTrack(mkTrack(0), undefined, { sources: [fixed('jamendo', () => [], true), fixed('archive', () => [])] });
    expect(rec.candidates).toEqual([]); expect(rec.errors.length).toBe(1); expect(statusOf(rec)).toBe('failed');
  });
  it('one failing source does not block the others; its error is recorded', async () => {
    const rec = await matchTrack(mkTrack(0), undefined, { sources: [fixed('jamendo', () => [], true), fixed('archive', () => [C('Tum Hi Ho', 'Arijit Singh', { album: 'Aashiqui 2' })])] });
    expect(rec.candidates.length).toBe(1); expect(rec.errors).toEqual([{ source: 'jamendo', message: 'jamendo down' }]);
  });
  it('prefers a downloadable candidate among near-equal matches; a source timeout is reported', async () => {
    const rec = await matchTrack(mkTrack(0), undefined, { sources: [fixed('jamendo', () => [C('Tum Hi Ho', 'Arijit Singh', { album: 'Aashiqui 2', key: 'a:1', download: { permitted: false, verified: true, reason: 'x' } }), C('Tum Hi Ho', 'Arijit Singh', { album: 'Aashiqui 2', key: 'a:2' })])] });
    expect(rec.candidates[0].key).toBe('a:2');
    const slow: MatchSource = { id: 'archive', name: 'slow', search: (_q, sig) => new Promise((_r, rej) => sig?.addEventListener('abort', () => rej(new Error('aborted')))) };
    const t = await matchTrack(mkTrack(0), undefined, { sources: [slow], timeoutMs: 20 }); expect(t.errors[0].message).toBe('timed out');
  });
  it('rejecting a candidate removes it and it is not suggested again on re-run', async () => {
    const o = { sources: [fixed('jamendo', () => [C('Tum Hi Ho', 'Arijit Singh', { album: 'Aashiqui 2' })])] }; const t = mkTrack(0);
    let rec = await matchTrack(t, undefined, o); await cat.putMatch(rec, statusOf(rec), null); await rejectMatch(cat, t.id);
    expect((await cat.s.tracks.get(t.id))!.matching_status).toBe('no_match'); rec = await matchTrack(t, await cat.getMatch(t.id), o); expect(rec.candidates).toEqual([]);
  });
  it('a LOCAL file match registers the local file and marks the song downloaded (never downgraded afterwards)', async () => {
    const src = fixed('local', () => [C('Tum Hi Ho', 'Arijit Singh', { album: 'Aashiqui 2', source: 'local', source_id: 'lo-ms-9', key: 'local:lo-ms-9', download: { permitted: true, verified: true, local: true, reason: 'Already stored on this device' } })]);
    await matchMany(cat, [(await cat.s.tracks.get('spotify:t0'))!], { sources: [src] });
    expect(await cat.s.tracks.get('spotify:t0')).toMatchObject({ matching_status: 'downloaded', local_file_id: 'lo-ms-9' });
    await cat.putMatch({ track_id: 'spotify:t0', candidates: [], selected: null, selected_by: null, band: null, rejected: [], errors: [], skipped: false, checked_at: 1 }, 'no_match', null);
    expect((await cat.s.tracks.get('spotify:t0'))!.matching_status).toBe('downloaded');
  });
  it('bulk: matches many with concurrency, reports progress, skips non-songs/unavailable/already-matched, retries failures', async () => {
    await cat.s.tracks.put('spotify:t4', mkTrack(4, { import_status: 'not_music', matching_status: 'unavailable' })); await cat.s.tracks.put('spotify:t5', mkTrack(5, { matching_status: 'downloaded', local_file_id: 'lo-1' }));
    let calls = 0, flaky = true;
    const src: MatchSource = { id: 'jamendo', name: 'j', search: async q => { calls++; if (q.title === 'Song 2' && flaky) throw new Error('boom'); return [C(q.title, 'Arijit Singh', { album: 'Aashiqui 2' })]; } };
    const prog: number[] = []; const all = await cat.tracks();
    const r = await matchMany(cat, all, { sources: [src], concurrency: 3, onProgress: p => prog.push(p.done) });
    expect(r).toMatchObject({ total: 4, done: 4, failed: 1 }); expect(calls).toBe(4); expect(Math.max(...prog)).toBe(4);
    expect((await cat.s.tracks.get('spotify:t2'))!.matching_status).toBe('failed'); expect((await cat.s.tracks.get('spotify:t1'))!.matching_status).toBe('download_permitted');
    expect((await cat.s.tracks.get('spotify:t4'))!.matching_status).toBe('unavailable'); expect((await cat.s.tracks.get('spotify:t5'))!.matching_status).toBe('downloaded');
    flaky = false; calls = 0; const r2 = await matchMany(cat, await cat.tracks(), { sources: [src] });   // retry only what is not matched yet
    expect(calls).toBe(1); expect(r2.failed).toBe(0); expect((await cat.s.tracks.get('spotify:t2'))!.matching_status).toBe('download_permitted');
  });
  it('skipped tracks stay skipped on bulk re-runs; un-skip restores', async () => {
    await skipTrack(cat, 'spotify:t1'); expect((await cat.s.tracks.get('spotify:t1'))!.matching_status).toBe('unavailable');
    let calls = 0; const src: MatchSource = { id: 'jamendo', name: 'j', search: async () => { calls++; return []; } }; await matchMany(cat, await cat.tracks(), { sources: [src] }); expect(calls).toBe(5);   // 6 tracks, the skipped one is not searched
    await skipTrack(cat, 'spotify:t1', false); expect((await cat.s.tracks.get('spotify:t1'))!.matching_status).toBe('no_match');
  });
  it('queries contain only title/artist — never playlist or account names', async () => {
    await cat.importPlaylist('spotify', 'user-private-id', { source_playlist_id: 'p', kind: 'playlist', name: 'My Secret Breakup Playlist', artwork_url: '', owner: 'Chetan', total: 1, snapshot_id: null }, [{ source_track_id: 'zz', song_title: 'Gerua', artist_name: 'Arijit Singh', album_name: 'Dilwale', artwork_url: '', duration_ms: 1, source_url: '', import_status: 'imported' }]);
    const seen: string[] = []; const j = new JamendoSource({ clientId: 'k', fetch: (async (u: string) => { seen.push(String(u)); return res({ headers: { status: 'success' }, results: [] }); }) as unknown as typeof fetch });
    await matchMany(cat, [(await cat.s.tracks.get('spotify:zz'))!], { sources: [j] }); expect(seen.join()).toContain('Gerua'); expect(seen.join()).not.toMatch(/Secret|Breakup|Chetan|user-private/);
  });
});

// ---------- Milestone 3 follow-up: names, ordering, summary, report, scale ----------
import { cleanPlaylistName, displayName } from '../src/lib/collector/playlistNames';
import { buildReport, orderedTracks, summarise } from '../src/lib/collector/match/report';
import { parseCsvPlaylist } from '../src/lib/collector/csv';
import { importCsvFiles } from '../src/lib/collector/importer';

describe('playlist display names', () => {
  it('cleans file names into readable titles', () => {
    expect(cleanPlaylistName('swarify bollywood 90s 2000s test fixed.csv')).toBe('Swarify Bollywood 90s 2000s');
    expect(cleanPlaylistName('Road_Trip_Hits (1).csv')).toBe('Road Trip Hits');
    expect(cleanPlaylistName('my-playlist_final_v2.CSV')).toBe('My Playlist');
    expect(cleanPlaylistName('test.csv')).toBe('Test');              // never ends up empty
    expect(cleanPlaylistName('Arijit Singh Best.csv')).toBe('Arijit Singh Best');
  });
  it('a user rename always wins; API playlists are left alone', () => {
    expect(displayName({ name: 'swarify_test_fixed', source_platform: 'csv', custom_name: 'My 90s' })).toBe('My 90s');
    expect(displayName({ name: 'swarify_test_fixed', source_platform: 'csv' })).toBe('Swarify');
    expect(displayName({ name: 'Road Trip (test)', source_platform: 'spotify' })).toBe('Road Trip (test)');
  });
  it('CSV import stores the clean name, a stable id, no redundant owner, and a rename survives re-import', async () => {
    const c = new Catalogue(memoryStores()); const csv = 'Track Name,Artist Name(s)\r\nA,B\r\n';
    await importCsvFiles(c, [{ name: 'swarify_bollywood_90s_test_fixed.csv', text: csv }]);
    const p = (await c.playlists('csv'))[0]; expect(p.name).toBe('Swarify Bollywood 90s'); expect(p.owner).toBe(''); expect(p.id).toBe('csv:file-swarify bollywood 90s test fixed');
    await c.renamePlaylist(p.id, '90s Hits'); await importCsvFiles(c, [{ name: 'swarify_bollywood_90s_test_fixed.csv', text: csv + 'C,D\r\n' }]);
    const q = (await c.playlists('csv'))[0]; expect(displayName(q)).toBe('90s Hits'); expect((await c.playlists('csv')).length).toBe(1);
  });
});

describe('original playlist order is preserved in matching views', () => {
  it('lists songs in playlist position order, playlist by playlist, each song once', async () => {
    const c = new Catalogue(memoryStores()); const mk = (n: string) => ({ source_track_id: n, song_title: n, artist_name: 'a', album_name: '', artwork_url: '', duration_ms: 1, source_url: '', import_status: 'imported' as const });
    await c.importPlaylist('spotify', 'u', { source_playlist_id: 'p1', kind: 'playlist', name: 'P1', artwork_url: '', owner: '', total: 3, snapshot_id: null }, ['zeta', 'alpha', 'mid'].map(mk));
    await c.importPlaylist('spotify', 'u', { source_playlist_id: 'p2', kind: 'playlist', name: 'P2', artwork_url: '', owner: '', total: 3, snapshot_id: null }, ['mid', 'beta', 'omega'].map(mk));
    const pls = await c.playlists('spotify'), tr = await c.tracks();
    expect(orderedTracks(pls, tr).map(o => o.track.song_title)).toEqual(['zeta', 'alpha', 'mid', 'beta', 'omega']);          // not alphabetical, no duplicate 'mid'
    expect(orderedTracks(pls, tr, 'spotify:p2').map(o => `${o.position}:${o.track.song_title}`)).toEqual(['1:mid', '2:beta', '3:omega']);
  });
});

describe('50-song run (SIMULATED sources, realistic shape) — summary, report and request volume', () => {
  const titles = ['Pehla Nasha', 'Yeh Kaali Kaali Aankhen', 'Baazigar O Baazigar', 'Chura Ke Dil Mera', 'Tu Cheez Badi Hai Mast Mast', 'Tip Tip Barsa Paani', 'Mera Dil Bhi Kitna Pagal Hai', 'Bahut Pyaar Karte Hain', 'Dhak Dhak Karne Laga', 'Nazar Ke Samne'];
  const csv = 'Track Name,Artist Name(s),Album Name,Duration (ms)\r\n' + Array.from({ length: 50 }, (_, i) => `${titles[i % 10]}${i >= 10 ? ' ' + Math.floor(i / 10) : ''},Kumar Sanu;Alka Yagnik,Album ${i % 7},${240000 + (i % 9) * 3000}`).join('\r\n');
  it('commercial back-catalogue mostly has no free download: honest unavailable counts, order intact, report complete', async () => {
    const c = new Catalogue(memoryStores()); await importCsvFiles(c, [{ name: '90s.csv', text: csv }]);
    const tracks = await c.tracks(); expect(tracks.length).toBe(50);
    let calls = 0;
    // a catalogue that knows 3 songs: one exact+downloadable, one exact with no license, one cover only
    const src: MatchSource = { id: 'archive', name: 'a', search: async q => { calls++; const t = q.title;
      if (t === 'Pehla Nasha') return [C('Pehla Nasha', 'Kumar Sanu', { album: 'Album 0', duration_ms: q.duration_ms })];
      if (t === 'Tip Tip Barsa Paani') return [C('Tip Tip Barsa Paani', 'Kumar Sanu', { duration_ms: q.duration_ms, download: { permitted: false, verified: true, reason: 'No explicit open license' } })];
      if (t === 'Chura Ke Dil Mera') return [C('Chura Ke Dil Mera (Cover)', 'Someone Else')]; return []; } };
    const r = await matchMany(c, tracks, { sources: [src], concurrency: 2 }); expect(r).toMatchObject({ total: 50, done: 50, failed: 0 }); expect(calls).toBe(50);
    const pls = await c.playlists(); const ordered = orderedTracks(pls, await c.tracks()); expect(ordered.length).toBe(50); expect(ordered[0].track.song_title).toBe('Pehla Nasha'); expect(ordered[49].position).toBe(50);
    const s = summarise(ordered.map(o => o.track), await c.matches());
    // two titles exist verbatim; the cover by an unrelated artist scores <40 and is not even listed; the rest have nothing
    expect(s).toMatchObject({ total: 50, exact: 2, possible: 0, review: 0, unavailable: 48, downloadable: 1, onDevice: 0, unsearched: 0 });
    const rep = buildReport(ordered, await c.matches()).split('\n'); expect(rep.length).toBe(51); expect(rep[0]).toContain('Best match'); expect(rep[1]).toContain('Pehla Nasha');
  });
});

describe('Internet Archive prefilter', () => {
  it('only opens metadata for plausibly matching titles (saves requests)', async () => {
    const urls: string[] = [];
    const s = new ArchiveSource({ fetch: (async (u: string) => { urls.push(String(u)); if (String(u).includes('advancedsearch')) return res({ response: { docs: [{ identifier: 'good', title: 'Tum Hi Ho' }, { identifier: 'junk1', title: 'Completely Different Podcast' }, { identifier: 'junk2', title: 'Another Thing' }] } }); return res({ metadata: { title: 'Tum Hi Ho' }, files: [] }); }) as unknown as typeof fetch });
    await s.search(Q('Tum Hi Ho', 'Arijit Singh')); expect(urls.filter(u => u.includes('/metadata/')).map(u => u.split('/metadata/')[1])).toEqual(['good']);
  });
});
