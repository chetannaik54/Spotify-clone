// A fake Google OAuth (device flow) + YouTube Data API v3 following the documented shapes. SIMULATED — not the real service.
export type FakeVideo = { id: string; title: string; channel: string; cat?: string; dur?: string; privacy?: string; thumb?: boolean };
export type FakePlaylist = { id: string; title: string; videos: (FakeVideo | { missing: 'private' | 'deleted'; id?: string })[] };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

export class FakeGoogle {
  calls: { url: string; method: string; body?: string; auth?: string }[] = [];
  clientId = 'cid.apps.googleusercontent.com'; clientSecret = 'GOCSPX-secret';
  deviceCode = 'DEV123'; userCode = 'ABCD-EFGH'; approved = false; denied = false; pendingPolls = 2; slowDownOnce = false; expiredToken = false; expiresIn = 3600;
  accessToken = 'YA1'; refreshToken = 'YR1'; n = 1; revokedGrant = false; revoked: string[] = [];
  playlists: FakePlaylist[] = []; liked: FakeVideo[] = []; pageSize = 50; failNext: { status: number; reason: string; times: number } | null = null;
  profile = { id: 'UC123', title: 'Test Channel' };
  polls = 0;

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input); const u = new URL(url); const body = init?.body ? String(init.body) : undefined;
    const h = (init?.headers ?? {}) as Record<string, string>;
    this.calls.push({ url, method: init?.method ?? 'GET', body, auth: h.Authorization });
    if (u.host === 'oauth2.googleapis.com') {
      const b = new URLSearchParams(body);
      if (u.pathname === '/device/code') {
        if (b.get('client_id') !== this.clientId) return json({ error: 'invalid_client' }, 401);
        if (b.get('scope') !== 'https://www.googleapis.com/auth/youtube.readonly') return json({ error: 'invalid_scope' }, 400);
        return json({ device_code: this.deviceCode, user_code: this.userCode, verification_url: 'https://www.google.com/device', expires_in: 1800, interval: 5 });
      }
      if (u.pathname === '/token') {
        if (b.get('grant_type') === 'urn:ietf:params:oauth:grant-type:device_code') {
          this.polls++;
          if (b.get('client_secret') !== this.clientSecret) return json({ error: 'invalid_client' }, 401);
          if (this.denied) return json({ error: 'access_denied' }, 403);
          if (this.expiredToken) return json({ error: 'expired_token' }, 400);
          if (this.slowDownOnce) { this.slowDownOnce = false; return json({ error: 'slow_down' }, 403); }
          if (!this.approved || this.pendingPolls-- > 0) return json({ error: 'authorization_pending' }, 428);
          return json({ access_token: this.accessToken, refresh_token: this.refreshToken, expires_in: this.expiresIn, scope: 'https://www.googleapis.com/auth/youtube.readonly', token_type: 'Bearer' });
        }
        if (b.get('grant_type') === 'refresh_token') {
          if (this.revokedGrant || b.get('refresh_token') !== this.refreshToken) return json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
          this.n++; this.accessToken = `YA${this.n}`; return json({ access_token: this.accessToken, expires_in: this.expiresIn, scope: 'https://www.googleapis.com/auth/youtube.readonly', token_type: 'Bearer' }); // no new refresh_token (as Google does)
        }
      }
      if (u.pathname === '/revoke') { this.revoked.push(b.get('token') ?? ''); return json({}, 200); }
    }
    if (u.host === 'www.googleapis.com' && u.pathname.startsWith('/youtube/v3/')) {
      if (h.Authorization !== `Bearer ${this.accessToken}`) return json({ error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } }, 401);
      if (this.failNext && this.failNext.times > 0) { this.failNext.times--; return json({ error: { code: this.failNext.status, message: 'injected', errors: [{ reason: this.failNext.reason }] } }, this.failNext.status); }
      const ep = u.pathname.replace('/youtube/v3/', ''); const q = u.searchParams;
      const page = <T,>(all: T[]) => { const lim = Math.min(+(q.get('maxResults') ?? 5), this.pageSize); const off = +(q.get('pageToken') ?? 0); const items = all.slice(off, off + lim); return { items, pageInfo: { totalResults: all.length }, ...(off + lim < all.length ? { nextPageToken: String(off + lim) } : {}) }; };
      const thumbs = (id: string) => ({ default: { url: `https://i.ytimg.com/vi/${id}/default.jpg` }, high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } });
      const vid = (v: FakeVideo) => ({ id: v.id, snippet: { title: v.title, channelTitle: v.channel, categoryId: v.cat, thumbnails: thumbs(v.id) }, contentDetails: { duration: v.dur ?? 'PT4M10S' }, status: { privacyStatus: v.privacy ?? 'public' } });
      const allVideos = new Map<string, FakeVideo>(); for (const p of this.playlists) for (const v of p.videos) if (!('missing' in v)) allVideos.set(v.id, v); for (const v of this.liked) allVideos.set(v.id, v);
      if (ep === 'channels') return json({ items: [{ id: this.profile.id, snippet: { title: this.profile.title } }] });
      if (ep === 'playlists') return json(page(this.playlists.map(p => ({ id: p.id, snippet: { title: p.title, channelTitle: this.profile.title, thumbnails: thumbs(p.id) }, contentDetails: { itemCount: p.videos.length } }))));
      if (ep === 'playlistItems') {
        const pl = this.playlists.find(p => p.id === q.get('playlistId')); if (!pl) return json({ error: { code: 404, message: 'Playlist not found', errors: [{ reason: 'playlistNotFound' }] } }, 404);
        if (pl.id.startsWith('forbidden')) return json({ error: { code: 403, message: 'forbidden', errors: [{ reason: 'playlistForbidden' }] } }, 403);
        return json(page(pl.videos.map((v, i) => 'missing' in v
          ? { snippet: { title: v.missing === 'private' ? 'Private video' : 'Deleted video', position: i, resourceId: { videoId: v.id ?? `gone${i}` } }, contentDetails: { videoId: v.id ?? `gone${i}` }, status: { privacyStatus: v.missing === 'private' ? 'private' : 'privacyStatusUnspecified' } }
          : { snippet: { title: v.title, position: i, videoOwnerChannelTitle: v.channel, thumbnails: thumbs(v.id), resourceId: { videoId: v.id }, publishedAt: `2024-0${(i % 9) + 1}-01T00:00:00Z` }, contentDetails: { videoId: v.id }, status: { privacyStatus: v.privacy ?? 'public' } })));
      }
      if (ep === 'videos') {
        if (q.get('myRating') === 'like') return json(page(this.liked.map(vid)));
        const ids = (q.get('id') ?? '').split(','); return json({ items: ids.map(id => allVideos.get(id)).filter((v): v is FakeVideo => !!v && v.privacy !== 'private').map(vid) });   // deleted/private are simply absent
      }
    }
    return json({ error: { code: 404, message: 'unknown ' + url } }, 404);
  };
}
