import type { Playlist, Track } from '../types';
import { displayName } from './playlistNames';
import type { ImportedPlaylist, ImportedTrack, MatchingStatus } from './types';

export const MIRROR_PREFIX = 'imp:';
const REASON: Record<MatchingStatus, string> = {
  pending_match: 'Not matched yet', matched: 'Matched — no download permitted', possible_match: 'Match needs your review', no_match: 'Not available as a free download',
  download_permitted: 'Ready to download', downloading: 'Downloading…', downloaded: 'On device', unavailable: 'Unavailable', failed: 'Search failed — retry',
};

/**
 * Swarify playlists that mirror imported ones: original name, artwork, order and source. Every original entry stays — songs with a
 * local file play; the rest are greyed placeholders with the reason. Nothing is dropped or silently replaced.
 */
export function buildMirror(imported: ImportedPlaylist[], tracks: ImportedTrack[], local: Track[]): Playlist[] {
  const byTrack = new Map(tracks.map(t => [t.id, t])); const localById = new Map(local.map(l => [l.id, l]));
  return imported.filter(p => p.entries.some(e => !e.removed_at)).map(p => {
    const entries = [...p.entries].filter(e => !e.removed_at).sort((a, b) => a.position - b.position);
    const list: Track[] = [];
    for (const e of entries) {
      const t = byTrack.get(e.track_id); if (!t) continue;
      const file = t.local_file_id ? localById.get(t.local_file_id) : undefined;
      if (file && file.url) list.push({ ...file, art: file.art || t.artwork_url });
      else list.push({ id: t.id, title: t.song_title, artist: t.artist_name || t.channel || 'Unknown artist', album: t.album_name, art: t.artwork_url, url: '', source: 'local', duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : undefined,
        unavailable: t.import_status === 'not_music' ? 'Not a song' : t.import_status === 'unavailable' ? 'Unavailable on the source' : REASON[t.matching_status] });
    }
    return { id: `${MIRROR_PREFIX}${p.id}`, name: displayName(p), tracks: list, source: { platform: p.source_platform, playlistId: p.id, importedAt: p.imported_at, total: entries.length, art: p.artwork_url } };
  });
}

/** Replace only the mirrored playlists; the user's own playlists are never touched. */
export function mergeMirror(existing: Playlist[], mirrored: Playlist[]): Playlist[] {
  const keep = existing.filter(p => !p.id.startsWith(MIRROR_PREFIX));
  return [...keep, ...mirrored];
}
