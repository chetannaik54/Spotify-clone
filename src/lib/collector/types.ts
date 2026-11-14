export type Platform = 'spotify' | 'youtube' | 'csv';

export type MatchingStatus = 'pending_match' | 'matched' | 'possible_match' | 'no_match' | 'download_permitted' | 'downloading' | 'downloaded' | 'unavailable' | 'failed';
export type ImportStatus = 'imported' | 'unavailable' | 'not_music';

/** One row per (platform, source track) — stored once no matter how many playlists contain it. */
export type ImportedTrack = {
  id: string;                    // `${platform}:${source_track_id}` — also the dedupe key
  user_id: string;               // account id on the source platform
  source_platform: Platform;
  source_track_id: string;
  song_title: string;
  artist_name: string;
  album_name: string;
  artwork_url: string;
  duration_ms: number;
  source_url: string;
  import_status: ImportStatus;
  matching_status: MatchingStatus;
  local_file_id: string | null;  // set when a downloaded file has been registered in the local library
  channel?: string;              // YouTube channel (label channels make poor artist names)
  music_confidence?: number;     // 0..1 — how sure we are this video is a song (YouTube)
  user_override?: boolean;       // user decided song / not-a-song; re-imports must not undo it
  created_at: number;
  updated_at: number;
};

export type PlaylistEntry = { track_id: string; position: number; added_at: string | null; removed_at?: number };

/** Original playlist structure, with ordering preserved. A song in N playlists appears in N entry lists, one catalogue row. */
export type ImportedPlaylist = {
  id: string;                    // `${platform}:${source_playlist_id}`
  user_id: string;
  source_platform: Platform;
  source_playlist_id: string;
  kind: 'playlist' | 'liked';
  name: string;
  custom_name?: string;          // user rename; survives re-imports
  artwork_url: string;
  owner: string;
  total: number;                 // total reported by the source
  entries: PlaylistEntry[];
  snapshot_id: string | null;
  selected: boolean;             // included in sync
  imported_at: number;
  updated_at: number;
  last_error: string | null;
};

export type SyncRecord = {
  id: string; platform: Platform; started_at: number; finished_at: number;
  ok: boolean; playlists: number; tracks_added: number; tracks_updated: number; errors: string[];
};

export type AccountMeta = { platform: Platform; user_id: string; display_name: string; connected_at: number; last_synced_at: number | null };
