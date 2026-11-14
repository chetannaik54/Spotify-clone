import type { IncomingPlaylist, IncomingTrack } from '../catalogue';
import { ReauthRequired, type SpotifyAuth } from './auth';

const API = 'https://api.spotify.com/v1';
export class SpotifyApiError extends Error { constructor(public status: number, msg: string, public retryAfter?: number) { super(msg); this.name = 'SpotifyApiError'; } }

export type ClientDeps = { fetch: typeof fetch; auth: SpotifyAuth; sleep?: (ms: number) => Promise<void>; maxRetries?: number };

type SImage = { url: string; width?: number | null };
type SArtist = { name: string };
type STrack = { id: string | null; type?: string; is_local?: boolean; name: string; artists: SArtist[]; album?: { name: string; images?: SImage[] }; duration_ms: number; external_urls?: { spotify?: string }; is_playable?: boolean };
type Page<T> = { items: T[]; next: string | null; total: number };
type SPlaylist = { id: string; name: string; images?: SImage[] | null; owner?: { display_name?: string; id: string }; snapshot_id?: string; items?: { total: number }; tracks?: { total: number } };

const pickArt = (imgs?: SImage[] | null) => { if (!imgs?.length) return ''; return (imgs.find(i => (i.width ?? 0) >= 250 && (i.width ?? 0) <= 700) ?? imgs[0]).url; };

export class SpotifyClient {
  private sleep: (ms: number) => Promise<void>; private max: number;
  constructor(private d: ClientDeps) { this.sleep = d.sleep ?? (ms => new Promise(r => setTimeout(r, ms))); this.max = d.maxRetries ?? 4; }

  /** One request with: bearer auth, a single token refresh on 401, Retry-After on 429, exponential backoff on 5xx. */
  async request<T>(urlOrPath: string): Promise<T> {
    const url = urlOrPath.startsWith('http') ? urlOrPath : API + urlOrPath;
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.d.auth.accessToken();
      let r: Response;
      try { r = await this.d.fetch(url, { headers: { Authorization: `Bearer ${token}` } }); }
      catch (e) { if (attempt >= this.max) throw new SpotifyApiError(0, `Network error: ${(e as Error).message}`); await this.sleep(500 * 2 ** attempt); continue; }
      if (r.ok) return r.json() as Promise<T>;
      if (r.status === 401) {
        if (refreshed) throw new ReauthRequired();
        refreshed = true; await this.d.auth.accessToken(true); continue; // may throw ReauthRequired
      }
      if (r.status === 429) {
        const ra = Math.min(Number(r.headers.get('Retry-After') ?? '1') || 1, 120);
        if (attempt >= this.max) throw new SpotifyApiError(429, 'Rate limited by Spotify — try again shortly', ra);
        await this.sleep(ra * 1000); continue;
      }
      if (r.status >= 500 && attempt < this.max) { await this.sleep(500 * 2 ** attempt); continue; }
      let msg = r.statusText; try { msg = (await r.json() as { error?: { message?: string } }).error?.message ?? msg; } catch { /* ignore */ }
      throw new SpotifyApiError(r.status, msg || `HTTP ${r.status}`);
    }
  }

  /** Follow `next` links until exhausted. */
  async *pages<T>(path: string): AsyncGenerator<Page<T>> {
    let next: string | null = path;
    while (next) { const p: Page<T> = await this.request<Page<T>>(next); yield p; next = p.next; }
  }

  me() { return this.request<{ id: string; display_name?: string }>('/me'); }

  async playlists(): Promise<IncomingPlaylist[]> {
    const out: IncomingPlaylist[] = [];
    for await (const p of this.pages<SPlaylist | null>('/me/playlists?limit=50'))
      for (const pl of p.items) if (pl) out.push({
        source_playlist_id: pl.id, kind: 'playlist', name: pl.name, artwork_url: pickArt(pl.images), owner: pl.owner?.display_name ?? pl.owner?.id ?? '',
        total: pl.items?.total ?? pl.tracks?.total ?? 0, snapshot_id: pl.snapshot_id ?? null });
    return out;
  }

  /** All items of one playlist in order. Tries the classic `/tracks` path, falls back to `/items` if Spotify has moved it. */
  async playlistItems(id: string): Promise<IncomingTrack[]> {
    const fields = 'items(added_at,is_local,track(id,type,is_local,name,artists(name),album(name,images),duration_ms,external_urls,is_playable)),next,total';
    const base = (seg: string) => `/playlists/${encodeURIComponent(id)}/${seg}?limit=100&additional_types=track&fields=${encodeURIComponent(fields)}`;
    let seg = 'tracks';
    const out: IncomingTrack[] = [];
    try { for await (const p of this.pages<{ added_at?: string; is_local?: boolean; track: STrack | null }>(base(seg))) out.push(...mapItems(p.items)); }
    catch (e) {
      if (!(e instanceof SpotifyApiError) || (e.status !== 404 && e.status !== 410) || out.length) throw e;
      seg = 'items';
      for await (const p of this.pages<{ added_at?: string; is_local?: boolean; track: STrack | null; item?: STrack | null }>(base(seg))) out.push(...mapItems(p.items));
    }
    return out;
  }

  async savedTracks(): Promise<IncomingTrack[]> {
    const out: IncomingTrack[] = [];
    for await (const p of this.pages<{ added_at?: string; track: STrack | null }>('/me/tracks?limit=50')) out.push(...mapItems(p.items));
    return out;
  }
}

/** Map API items to catalogue rows. Removed tracks, local files and podcast episodes are kept as `unavailable` so playlist order is preserved. */
export function mapItems(items: { added_at?: string; is_local?: boolean; track: STrack | null; item?: STrack | null }[]): IncomingTrack[] {
  return items.map((it, i) => {
    const t = it.track ?? it.item ?? null;
    if (!t) return { source_track_id: `unavailable-${i}-${it.added_at ?? ''}`, song_title: 'Unavailable track', artist_name: '', album_name: '', artwork_url: '', duration_ms: 0, source_url: '', import_status: 'unavailable' as const, added_at: it.added_at ?? null };
    const local = !!(it.is_local || t.is_local || !t.id);
    return {
      source_track_id: t.id ?? `local-${t.name}-${t.artists?.[0]?.name ?? ''}-${t.duration_ms}`,
      song_title: t.name, artist_name: (t.artists ?? []).map(a => a.name).join(', '), album_name: t.album?.name ?? '', artwork_url: pickArt(t.album?.images),
      duration_ms: t.duration_ms ?? 0, source_url: t.external_urls?.spotify ?? '',
      import_status: local || (t.type && t.type !== 'track') ? 'unavailable' as const : 'imported' as const, added_at: it.added_at ?? null,
    };
  });
}
