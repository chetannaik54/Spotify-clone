import type { AccountMeta, ImportedPlaylist, ImportedTrack, Platform, SyncRecord } from './types';
import { IdbKV, MemoryKV, type KV } from './kv';

export type Stores = { tracks: KV<ImportedTrack>; playlists: KV<ImportedPlaylist>; syncs: KV<SyncRecord>; accounts: KV<AccountMeta> };
export const idbStores = (): Stores => ({ tracks: new IdbKV('c_tracks'), playlists: new IdbKV('c_playlists'), syncs: new IdbKV('c_syncs'), accounts: new IdbKV('c_accounts') });
export const memoryStores = (): Stores => ({ tracks: new MemoryKV(), playlists: new MemoryKV(), syncs: new MemoryKV(), accounts: new MemoryKV() });

export type IncomingTrack = Pick<ImportedTrack, 'source_track_id' | 'song_title' | 'artist_name' | 'album_name' | 'artwork_url' | 'duration_ms' | 'source_url' | 'import_status'> & { added_at?: string | null; platform?: Platform; channel?: string; music_confidence?: number };
export type IncomingPlaylist = Pick<ImportedPlaylist, 'source_playlist_id' | 'kind' | 'name' | 'artwork_url' | 'owner' | 'total' | 'snapshot_id'>;

/**
 * The unified imported-track catalogue. A track is stored once per (platform, source id); playlists hold ordered
 * references. Re-imports update metadata but never reset matching/download state.
 */
export class Catalogue {
  private listeners = new Set<() => void>();
  constructor(readonly s: Stores) {}
  subscribe(f: () => void) { this.listeners.add(f); return () => this.listeners.delete(f); }
  private emit() { this.listeners.forEach(f => f()); }

  /** Replace a playlist's entries with the freshly fetched, ordered list. */
  async importPlaylist(platform: Platform, userId: string, pl: IncomingPlaylist, items: IncomingTrack[], now = Date.now()) {
    const pid = `${platform}:${pl.source_playlist_id}`;
    const prev = await this.s.playlists.get(pid);
    let added = 0, updated = 0;
    const entries: ImportedPlaylist['entries'] = [];
    const seen = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      const t = items[i]; const plat = t.platform ?? platform; const id = `${plat}:${t.source_track_id}`;
      const existing = await this.s.tracks.get(id);
      if (!existing) {
        added++;
        await this.s.tracks.put(id, {
          id, user_id: userId, source_platform: plat, source_track_id: t.source_track_id, song_title: t.song_title, artist_name: t.artist_name,
          album_name: t.album_name, artwork_url: t.artwork_url, duration_ms: t.duration_ms, source_url: t.source_url, import_status: t.import_status,
          matching_status: t.import_status === 'imported' ? 'pending_match' : 'unavailable', local_file_id: null, created_at: now, updated_at: now,
          channel: t.channel, music_confidence: t.music_confidence,
        });
      } else if (!seen.has(id)) {
        const changed = existing.song_title !== t.song_title || existing.artist_name !== t.artist_name || existing.album_name !== t.album_name ||
          existing.artwork_url !== t.artwork_url || existing.duration_ms !== t.duration_ms || (!existing.user_override && existing.import_status !== t.import_status);
        if (changed) {
          updated++;
          await this.s.tracks.put(id, { ...existing, song_title: t.song_title, artist_name: t.artist_name, album_name: t.album_name, artwork_url: t.artwork_url,
            duration_ms: t.duration_ms, channel: t.channel ?? existing.channel, music_confidence: t.music_confidence ?? existing.music_confidence,
            ...(existing.user_override ? {} : { import_status: t.import_status, matching_status: t.import_status === 'imported' ? (existing.matching_status === 'unavailable' ? 'pending_match' : existing.matching_status) : 'unavailable' }), updated_at: now });
        }
      }
      seen.add(id);
      entries.push({ track_id: id, position: i, added_at: t.added_at ?? null });
    }
    // entries that left the source playlist are kept (flagged) — local files and history are never deleted automatically
    const removed = (prev?.entries ?? []).filter(e => !seen.has(e.track_id)).map(e => ({ ...e, removed_at: e.removed_at ?? now }));
    const playlist: ImportedPlaylist = {
      id: pid, user_id: userId, source_platform: platform, source_playlist_id: pl.source_playlist_id, kind: pl.kind, name: pl.name,
      artwork_url: pl.artwork_url, owner: pl.owner, total: pl.total, entries: [...entries, ...removed], snapshot_id: pl.snapshot_id,
      selected: prev?.selected ?? true, imported_at: prev?.imported_at ?? now, updated_at: now, last_error: null,
    };
    await this.s.playlists.put(pid, playlist);
    this.emit();
    return { playlist, added, updated };
  }

  async noteFailure(platform: Platform, userId: string, pl: IncomingPlaylist, error: string, now = Date.now()) {
    const pid = `${platform}:${pl.source_playlist_id}`;
    const prev = await this.s.playlists.get(pid);
    await this.s.playlists.put(pid, prev ? { ...prev, last_error: error, updated_at: now } : {
      id: pid, user_id: userId, source_platform: platform, source_playlist_id: pl.source_playlist_id, kind: pl.kind, name: pl.name, artwork_url: pl.artwork_url,
      owner: pl.owner, total: pl.total, entries: [], snapshot_id: pl.snapshot_id, selected: true, imported_at: now, updated_at: now, last_error: error });
    this.emit();
  }

  async setSelected(pid: string, selected: boolean) { const p = await this.s.playlists.get(pid); if (p) { await this.s.playlists.put(pid, { ...p, selected }); this.emit(); } }
  async playlists(platform?: Platform) { return (await this.s.playlists.all()).filter(p => !platform || p.source_platform === platform).sort((a, b) => (a.kind === 'liked' ? -1 : 0) - (b.kind === 'liked' ? -1 : 0) || a.name.localeCompare(b.name)); }
  async tracks(platform?: Platform) { return (await this.s.tracks.all()).filter(t => !platform || t.source_platform === platform); }
  /** Tracks of one playlist in original order (entries removed at the source excluded). */
  async playlistTracks(pid: string) {
    const p = await this.s.playlists.get(pid); if (!p) return [];
    const out: ImportedTrack[] = [];
    for (const e of p.entries.filter(e => !e.removed_at).sort((a, b) => a.position - b.position)) { const t = await this.s.tracks.get(e.track_id); if (t) out.push(t); }
    return out;
  }
  /** Which playlists contain a track. */
  async playlistsOf(trackId: string) { return (await this.s.playlists.all()).filter(p => p.entries.some(e => e.track_id === trackId && !e.removed_at)); }

  /** The user's call on whether a video is a song. Survives re-imports. */
  async setMusicOverride(trackId: string, isMusic: boolean) {
    const t = await this.s.tracks.get(trackId); if (!t) return;
    await this.s.tracks.put(trackId, { ...t, import_status: isMusic ? 'imported' : 'not_music', matching_status: isMusic ? 'pending_match' : 'unavailable', user_override: true, updated_at: Date.now() });
    this.emit();
  }
  async addSync(r: SyncRecord) { await this.s.syncs.put(r.id, r); this.emit(); }
  async syncs() { return (await this.s.syncs.all()).sort((a, b) => b.started_at - a.started_at).slice(0, 50); }
  async account(platform: Platform) { return this.s.accounts.get(platform); }
  async setAccount(a: AccountMeta) { await this.s.accounts.put(a.platform, a); this.emit(); }

  /** Disconnect: forget the account. Imported metadata and any downloaded files are kept unless `purge` is true. */
  async removeAccount(platform: Platform, purge = false) {
    await this.s.accounts.del(platform);
    if (purge) {
      for (const p of await this.s.playlists.all()) if (p.source_platform === platform) await this.s.playlists.del(p.id);
      for (const t of await this.s.tracks.all()) if (t.source_platform === platform && !t.local_file_id) await this.s.tracks.del(t.id);
    }
    this.emit();
  }
}
