import type { IncomingPlaylist, IncomingTrack } from '../catalogue';
import { GoogleReauthRequired, type GoogleAuth } from '../google/auth';
import { classifyVideo, isoDurationSeconds } from './classify';

const API = 'https://www.googleapis.com/youtube/v3';
export class YouTubeApiError extends Error { constructor(public status: number, public reason: string, msg: string) { super(msg); this.name = 'YouTubeApiError'; } }
export type YtDeps = { fetch: typeof fetch; auth: GoogleAuth; sleep?: (ms: number) => Promise<void>; maxRetries?: number };

type Thumb = { url: string; width?: number };
type Thumbs = Record<string, Thumb | undefined>;
const pickThumb = (t?: Thumbs) => t?.maxres?.url ?? t?.standard?.url ?? t?.high?.url ?? t?.medium?.url ?? t?.default?.url ?? '';
type Page<T> = { items: T[]; nextPageToken?: string; pageInfo?: { totalResults: number } };
type YtVideo = { id: string; snippet: { title: string; channelTitle: string; categoryId?: string; thumbnails?: Thumbs }; contentDetails?: { duration?: string }; status?: { privacyStatus?: string } };
type YtPlaylistItem = { snippet: { title: string; position: number; videoOwnerChannelTitle?: string; thumbnails?: Thumbs; resourceId?: { videoId?: string }; publishedAt?: string }; contentDetails?: { videoId?: string }; status?: { privacyStatus?: string } };

export class YouTubeClient {
  private sleep: (ms: number) => Promise<void>; private max: number;
  constructor(private d: YtDeps) { this.sleep = d.sleep ?? (ms => new Promise(r => setTimeout(r, ms))); this.max = d.maxRetries ?? 4; }

  async request<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const q = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
    const url = `${API}/${path}?${q}`; let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.d.auth.accessToken();
      let r: Response;
      try { r = await this.d.fetch(url, { headers: { Authorization: `Bearer ${token}` } }); }
      catch (e) { if (attempt >= this.max) throw new YouTubeApiError(0, 'network', `Network error: ${(e as Error).message}`); await this.sleep(500 * 2 ** attempt); continue; }
      if (r.ok) return r.json() as Promise<T>;
      let reason = '', msg = r.statusText;
      try { const j = await r.json() as { error?: { message?: string; errors?: { reason?: string }[]; status?: string } }; reason = j.error?.errors?.[0]?.reason ?? j.error?.status ?? ''; msg = j.error?.message ?? msg; } catch { /* ignore */ }
      if (r.status === 401) { if (refreshed) throw new GoogleReauthRequired(); refreshed = true; await this.d.auth.accessToken(true); continue; }
      if (r.status === 429 || (r.status === 403 && /rateLimit/i.test(reason))) { if (attempt >= this.max) throw new YouTubeApiError(r.status, reason, 'Rate limited by YouTube — try again shortly'); await this.sleep(1000 * 2 ** attempt); continue; }
      if (r.status >= 500 && attempt < this.max) { await this.sleep(500 * 2 ** attempt); continue; }
      throw new YouTubeApiError(r.status, reason, msg || `HTTP ${r.status}`);
    }
  }

  private async *pages<T>(path: string, params: Record<string, string | number | boolean | undefined>): AsyncGenerator<Page<T>> {
    let token: string | undefined;
    do { const p: Page<T> = await this.request<Page<T>>(path, { ...params, pageToken: token }); yield p; token = p.nextPageToken; } while (token);
  }

  async me() { const r = await this.request<Page<{ id: string; snippet: { title: string } }>>('channels', { part: 'snippet', mine: true }); const c = r.items?.[0]; return { id: c?.id ?? 'me', display_name: c?.snippet.title ?? 'YouTube account' }; }

  async playlists(): Promise<IncomingPlaylist[]> {
    const out: IncomingPlaylist[] = [];
    for await (const p of this.pages<{ id: string; snippet: { title: string; channelTitle?: string; thumbnails?: Thumbs }; contentDetails?: { itemCount?: number } }>('playlists', { part: 'snippet,contentDetails', mine: true, maxResults: 50 }))
      for (const pl of p.items) out.push({ source_playlist_id: pl.id, kind: 'playlist', name: pl.snippet.title, artwork_url: pickThumb(pl.snippet.thumbnails), owner: pl.snippet.channelTitle ?? '', total: pl.contentDetails?.itemCount ?? 0, snapshot_id: null });
    return out;
  }

  /** Video details (category, duration, privacy) for up to N ids, 50 per request. Missing ids = deleted/private. */
  async videoDetails(ids: string[]): Promise<Map<string, YtVideo>> {
    const m = new Map<string, YtVideo>();
    for (let i = 0; i < ids.length; i += 50) {
      const r = await this.request<Page<YtVideo>>('videos', { part: 'snippet,contentDetails,status', id: ids.slice(i, i + 50).join(','), maxResults: 50 });
      for (const v of r.items) m.set(v.id, v);
    }
    return m;
  }

  /** Playlist items in original order. Deleted/private/unavailable videos stay in place, marked unavailable. */
  async playlistItems(id: string): Promise<IncomingTrack[]> {
    const raw: YtPlaylistItem[] = [];
    for await (const p of this.pages<YtPlaylistItem>('playlistItems', { part: 'snippet,contentDetails,status', playlistId: id, maxResults: 50 })) raw.push(...p.items);
    raw.sort((a, b) => a.snippet.position - b.snippet.position);
    const ids = [...new Set(raw.map(i => i.contentDetails?.videoId ?? i.snippet.resourceId?.videoId).filter((x): x is string => !!x))];
    const details = await this.videoDetails(ids);
    return raw.map((it, i) => {
      const vid = it.contentDetails?.videoId ?? it.snippet.resourceId?.videoId; const d = vid ? details.get(vid) : undefined;
      const priv = it.status?.privacyStatus === 'private' || d?.status?.privacyStatus === 'private';
      if (!vid || !d || priv || /^(private|deleted) video$/i.test(it.snippet.title))
        return { source_track_id: vid ?? `missing-${i}`, song_title: it.snippet.title && !/^(private|deleted) video$/i.test(it.snippet.title) ? it.snippet.title : /private/i.test(it.snippet.title) ? 'Private video' : 'Deleted video', artist_name: '', album_name: '', artwork_url: '', duration_ms: 0, source_url: vid ? `https://www.youtube.com/watch?v=${vid}` : '', import_status: 'unavailable' as const, added_at: it.snippet.publishedAt ?? null };
      return mapVideo(d, it.snippet.publishedAt);
    });
  }

  /** Liked videos (`myRating=like`). Not capped by the playlist API; includes category + duration so music can be identified. */
  async likedVideos(): Promise<IncomingTrack[]> {
    const out: IncomingTrack[] = [];
    for await (const p of this.pages<YtVideo>('videos', { part: 'snippet,contentDetails,status', myRating: 'like', maxResults: 50 })) out.push(...p.items.map(v => mapVideo(v)));
    return out;
  }
}

export function mapVideo(v: YtVideo, addedAt?: string): IncomingTrack {
  const dur = isoDurationSeconds(v.contentDetails?.duration);
  const c = classifyVideo({ title: v.snippet.title, channel: v.snippet.channelTitle, categoryId: v.snippet.categoryId, durationSec: dur });
  return { source_track_id: v.id, song_title: c.isMusic ? c.title : v.snippet.title, artist_name: c.isMusic ? c.artist : '', album_name: c.isMusic ? c.album : '', artwork_url: pickThumb(v.snippet.thumbnails),
    duration_ms: dur * 1000, source_url: `https://www.youtube.com/watch?v=${v.id}`, import_status: c.isMusic ? 'imported' : 'not_music', added_at: addedAt ?? null, channel: v.snippet.channelTitle, music_confidence: c.confidence };
}
