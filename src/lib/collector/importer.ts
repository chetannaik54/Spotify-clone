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
