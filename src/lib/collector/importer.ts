import type { Catalogue } from './catalogue';
import { ReauthRequired } from './spotify/auth';
import { SpotifyApiError, type SpotifyClient } from './spotify/client';
import type { SyncRecord } from './types';

export type ImportOpts = {
  playlists?: boolean; liked?: boolean;
  /** Sync only playlists the user has left selected (new playlists are selected by default). */
  onlySelected?: boolean;
  onProgress?: (msg: string, done: number, total: number) => void;
  now?: () => number;
};

/** Explain the most common real-world cause when the very first call (profile) is refused after a successful sign-in. */
export const ACCESS_DENIED_HELP = 'Spotify signed you in but refused to share your data (HTTP 403). This usually means the Spotify developer app does not have "Web API" enabled — Spotify now requires a Premium account for that — or your Spotify account is not listed under the app\'s User Management. Fix it in developer.spotify.com/dashboard, then reconnect.';
export const friendly = (e: unknown) => {
  if (e instanceof SpotifyApiError) {
    if (e.status === 403) return 'Spotify did not allow reading this item (restricted playlist or API access limit)';
    if (e.status === 404) return 'Not found on Spotify (deleted or private)';
    if (e.status === 429) return 'Rate limited by Spotify — retry later';
    return `Spotify error ${e.status}: ${e.message}`;
  }
  return (e as Error).message;
};

/**
 * Import the user's Spotify metadata (titles, artists, albums, artwork, durations, IDs) into the catalogue.
 * Never touches audio. One failing playlist does not abort the rest; ordering is preserved.
 */
export async function importSpotify(client: SpotifyClient, cat: Catalogue, opts: ImportOpts = {}): Promise<SyncRecord> {
  const now = opts.now ?? Date.now; const started = now();
  const rec: SyncRecord = { id: `sync-${started}`, platform: 'spotify', started_at: started, finished_at: started, ok: true, playlists: 0, tracks_added: 0, tracks_updated: 0, errors: [] };
  const wantPlaylists = opts.playlists ?? true, wantLiked = opts.liked ?? true;
  try {
    let me;
    try { me = await client.me(); }
    catch (e) { if (e instanceof SpotifyApiError && e.status === 403) throw new SpotifyApiError(403, `${ACCESS_DENIED_HELP}${e.message && !/^HTTP/.test(e.message) ? ` (Spotify said: ${e.message})` : ''}`); throw e; }
    const prevAcc = await cat.account('spotify');
    await cat.setAccount({ platform: 'spotify', user_id: me.id, display_name: me.display_name || me.id, connected_at: prevAcc?.connected_at ?? started, last_synced_at: prevAcc?.last_synced_at ?? null });

    let lists = wantPlaylists ? await client.playlists() : [];
    if (opts.onlySelected) {
      const known = new Map((await cat.playlists('spotify')).map(p => [p.source_playlist_id, p.selected]));
      lists = lists.filter(l => known.get(l.source_playlist_id) !== false);
    }
    const total = lists.length + (wantLiked ? 1 : 0); let done = 0;
    for (const pl of lists) {
      opts.onProgress?.(`Importing “${pl.name}”`, done, total);
      try {
        const items = await client.playlistItems(pl.source_playlist_id);
        const r = await cat.importPlaylist('spotify', me.id, pl, items, now());
        rec.tracks_added += r.added; rec.tracks_updated += r.updated; rec.playlists++;
      } catch (e) {
        if (e instanceof ReauthRequired) throw e;
        const msg = friendly(e); rec.errors.push(`${pl.name}: ${msg}`); await cat.noteFailure('spotify', me.id, pl, msg, now());
      }
      done++;
    }
    if (wantLiked) {
      opts.onProgress?.('Importing Liked Songs', done, total);
      try {
        const items = await client.savedTracks();
        const r = await cat.importPlaylist('spotify', me.id, { source_playlist_id: 'liked', kind: 'liked', name: 'Liked Songs', artwork_url: '', owner: me.display_name || me.id, total: items.length, snapshot_id: null }, items, now());
        rec.tracks_added += r.added; rec.tracks_updated += r.updated; rec.playlists++;
      } catch (e) { if (e instanceof ReauthRequired) throw e; rec.errors.push(`Liked Songs: ${friendly(e)}`); }
      done++;
    }
    rec.ok = rec.errors.length < Math.max(1, total);       // fully failed import = not ok
    opts.onProgress?.('Done', total, total);
    const acc = await cat.account('spotify'); if (acc && rec.ok) await cat.setAccount({ ...acc, last_synced_at: now() });
  } catch (e) {
    rec.ok = false; rec.errors.push(e instanceof ReauthRequired ? e.message : friendly(e));
    rec.finished_at = now(); await cat.addSync(rec); throw e;
  }
  rec.finished_at = now(); await cat.addSync(rec);
  return rec;
}

// ---------------------------------------------------------------- YouTube
import { GoogleReauthRequired } from './google/auth';
import { YouTubeApiError, type YouTubeClient } from './youtube/client';
import { parseCsvPlaylist } from './csv';

export const YT_NOT_ENABLED_HELP = 'YouTube refused the request. In your Google Cloud project, make sure “YouTube Data API v3” is enabled and your Google account is listed as a test user on the OAuth consent screen.';
export const friendlyYt = (e: unknown) => {
  if (e instanceof YouTubeApiError) {
    if (e.reason === 'quotaExceeded' || e.reason === 'dailyLimitExceeded') return 'YouTube’s daily API quota is used up — try again tomorrow';
    if (e.reason === 'accessNotConfigured' || e.reason === 'SERVICE_DISABLED') return 'The YouTube Data API v3 is not enabled for your Google Cloud project — enable it, then retry';
    if (e.status === 403) return e.reason === 'forbidden' || e.reason === 'playlistForbidden' ? 'This playlist is private or not accessible to your account' : `YouTube refused access (${e.reason || '403'})`;
    if (e.status === 404) return 'Not found on YouTube (deleted or private)';
    if (e.status === 429) return 'Rate limited by YouTube — retry later';
    return `YouTube error ${e.status}: ${e.message}`;
  }
  return (e as Error).message;
};

/** Import the user's YouTube playlists + liked videos (metadata only). Videos are scored for “is this a song?”; non-songs stay in the playlist, flagged. */
export async function importYouTube(client: YouTubeClient, cat: Catalogue, opts: ImportOpts = {}): Promise<SyncRecord> {
  const now = opts.now ?? Date.now; const started = now();
  const rec: SyncRecord = { id: `sync-${started}`, platform: 'youtube', started_at: started, finished_at: started, ok: true, playlists: 0, tracks_added: 0, tracks_updated: 0, errors: [] };
  const wantPlaylists = opts.playlists ?? true, wantLiked = opts.liked ?? true;
  try {
    let me;
    try { me = await client.me(); }
    catch (e) { if (e instanceof YouTubeApiError && (e.status === 403 || e.status === 400)) throw new YouTubeApiError(e.status, e.reason, `${YT_NOT_ENABLED_HELP}${e.message ? ` (Google said: ${e.message})` : ''}`); throw e; }
    const prevAcc = await cat.account('youtube');
    await cat.setAccount({ platform: 'youtube', user_id: me.id, display_name: me.display_name, connected_at: prevAcc?.connected_at ?? started, last_synced_at: prevAcc?.last_synced_at ?? null });
    let lists = wantPlaylists ? await client.playlists() : [];
    if (opts.onlySelected) { const known = new Map((await cat.playlists('youtube')).map(p => [p.source_playlist_id, p.selected])); lists = lists.filter(l => known.get(l.source_playlist_id) !== false); }
    const total = lists.length + (wantLiked ? 1 : 0); let done = 0;
    for (const pl of lists) {
      opts.onProgress?.(`Importing “${pl.name}”`, done, total);
      try { const items = await client.playlistItems(pl.source_playlist_id); const r = await cat.importPlaylist('youtube', me.id, pl, items, now()); rec.tracks_added += r.added; rec.tracks_updated += r.updated; rec.playlists++; }
      catch (e) { if (e instanceof GoogleReauthRequired) throw e; const msg = friendlyYt(e); rec.errors.push(`${pl.name}: ${msg}`); await cat.noteFailure('youtube', me.id, pl, msg, now()); }
      done++;
    }
    if (wantLiked) {
      opts.onProgress?.('Importing liked videos', done, total);
      try { const items = await client.likedVideos(); const r = await cat.importPlaylist('youtube', me.id, { source_playlist_id: 'liked', kind: 'liked', name: 'Liked videos', artwork_url: '', owner: me.display_name, total: items.length, snapshot_id: null }, items, now()); rec.tracks_added += r.added; rec.tracks_updated += r.updated; rec.playlists++; }
      catch (e) { if (e instanceof GoogleReauthRequired) throw e; rec.errors.push(`Liked videos: ${friendlyYt(e)}`); }
      done++;
    }
    rec.ok = rec.errors.length < Math.max(1, total);
    opts.onProgress?.('Done', total, total);
    const acc = await cat.account('youtube'); if (acc && rec.ok) await cat.setAccount({ ...acc, last_synced_at: now() });
  } catch (e) { rec.ok = false; rec.errors.push(e instanceof GoogleReauthRequired ? e.message : friendlyYt(e)); rec.finished_at = now(); await cat.addSync(rec); throw e; }
  rec.finished_at = now(); await cat.addSync(rec); return rec;
}

// ---------------------------------------------------------------- CSV
export async function importCsvFiles(cat: Catalogue, files: { name: string; text: string }[], now: () => number = Date.now): Promise<SyncRecord> {
  const started = now();
  const rec: SyncRecord = { id: `sync-${started}`, platform: 'csv', started_at: started, finished_at: started, ok: true, playlists: 0, tracks_added: 0, tracks_updated: 0, errors: [] };
  for (const f of files) {
    const r = parseCsvPlaylist(f.name, f.text);
    if (r.error) { rec.errors.push(`${f.name}: ${r.error}`); continue; }
    const res = await cat.importPlaylist('csv', 'local', { source_playlist_id: `file-${r.playlistName.toLowerCase()}`, kind: 'playlist', name: r.playlistName, artwork_url: '', owner: 'CSV file', total: r.items.length, snapshot_id: null }, r.items, now());
    rec.playlists++; rec.tracks_added += res.added; rec.tracks_updated += res.updated;
    if (r.skipped) rec.errors.push(`${f.name}: ${r.skipped} row(s) without a title were skipped`);
  }
  rec.ok = rec.playlists > 0; rec.finished_at = now(); await cat.addSync(rec); return rec;
}
