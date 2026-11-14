// A fake Spotify Accounts + Web API implementing the documented response shapes. SIMULATED — not the real service.
export type FakeOpts = { pageSize?: number };
export type Rec = { url: string; method: string; headers: Record<string, string>; body?: string };

export function makeTracks(n: number, prefix = 't') {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, type: 'track', name: `Song ${prefix}${i}`, artists: [{ name: 'Arijit Singh' }, { name: 'Shreya Ghoshal' }], album: { name: `Album ${i % 5}`, images: [{ url: `https://img/${prefix}${i}-640.jpg`, width: 640 }, { url: `https://img/${prefix}${i}-64.jpg`, width: 64 }] }, duration_ms: 200000 + i, external_urls: { spotify: `https://open.spotify.com/track/${prefix}${i}` } }));
}

export class FakeSpotify {
  calls: Rec[] = [];
  tokenCalls: Rec[] = [];
  accessToken = 'AT1'; refreshToken = 'RT1'; expiresIn = 3600; n = 1;
  playlists: { id: string; name: string; tracks: unknown[]; fail?: number; owner?: string }[] = [];
  saved: unknown[] = [];
  profile = { id: 'user123', display_name: 'Test User' };
  failNext: { status: number; headers?: Record<string, string>; times: number } | null = null;
  tracksPathMoved = false;
  revoked = false;
  pageSize = 50;

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input); const u = new URL(url);
    const rec: Rec = { url, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? String(init.body) : undefined };
    if (u.host === 'accounts.spotify.com' && u.pathname === '/api/token') {
      this.tokenCalls.push(rec); const b = new URLSearchParams(rec.body);
      if (b.get('grant_type') === 'authorization_code') {
        if (!b.get('code_verifier') || b.get('code') !== 'GOODCODE') return json({ error: 'invalid_grant', error_description: 'bad code' }, 400);
        return json({ access_token: this.accessToken, refresh_token: this.refreshToken, expires_in: this.expiresIn, scope: 'playlist-read-private' });
      }
      if (this.revoked || b.get('refresh_token') !== this.refreshToken) return json({ error: 'invalid_grant', error_description: 'Refresh token revoked' }, 400);
      this.n++; this.accessToken = `AT${this.n}`;
      return json({ access_token: this.accessToken, expires_in: this.expiresIn, scope: 'playlist-read-private' }); // Spotify may omit refresh_token
    }
    this.calls.push(rec);
    const auth = rec.headers.Authorization; if (auth !== `Bearer ${this.accessToken}`) return json({ error: { status: 401, message: 'The access token expired' } }, 401);
    if (this.failNext && this.failNext.times > 0) { this.failNext.times--; return json({ error: { status: this.failNext.status, message: 'injected' } }, this.failNext.status, this.failNext.headers); }
    const page = (all: unknown[]) => { const lim = Math.min(+(u.searchParams.get('limit') ?? 50), this.pageSize), off = +(u.searchParams.get('offset') ?? 0); const items = all.slice(off, off + lim); const next = off + lim < all.length ? `${u.origin}${u.pathname}?${new URLSearchParams({ ...Object.fromEntries(u.searchParams), offset: String(off + lim), limit: String(lim) })}` : null; return { items, total: all.length, limit: lim, offset: off, next }; };
    if (u.pathname === '/v1/me') return json(this.profile);
    if (u.pathname === '/v1/me/playlists') return json(page(this.playlists.map(p => ({ id: p.id, name: p.name, images: [{ url: `https://img/pl-${p.id}.jpg`, width: 300 }], owner: { id: 'o', display_name: p.owner ?? 'Test User' }, snapshot_id: `snap-${p.id}`, tracks: { total: p.tracks.length } }))));
    if (u.pathname === '/v1/me/tracks') return json(page(this.saved.map((t, i) => ({ added_at: `2024-01-${String(i % 28 + 1).padStart(2, '0')}T00:00:00Z`, track: t }))));
    const m = u.pathname.match(/^\/v1\/playlists\/([^/]+)\/(tracks|items)$/);
    if (m) {
      const pl = this.playlists.find(p => p.id === m[1]); if (!pl) return json({ error: { status: 404, message: 'Not found' } }, 404);
      if (this.tracksPathMoved && m[2] === 'tracks') return json({ error: { status: 404, message: 'moved' } }, 404);
      if (pl.fail) return json({ error: { status: pl.fail, message: 'Forbidden' } }, pl.fail);
      return json(page(pl.tracks.map((t, i) => ({ added_at: `2024-02-${String(i % 28 + 1).padStart(2, '0')}T00:00:00Z`, is_local: false, track: t }))));
    }
    return json({ error: { status: 404, message: 'unknown ' + u.pathname } }, 404);
  };
}
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', ...headers } });
