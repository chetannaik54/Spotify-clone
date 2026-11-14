import type { SecureStore } from '../secure';

export const SPOTIFY_SCOPES = ['playlist-read-private', 'playlist-read-collaborative', 'user-library-read']; // minimum for read-only import
const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const K = { tokens: 'spotify.tokens', pending: 'spotify.pending', clientId: 'spotify.clientId' };

export class ReauthRequired extends Error { constructor(msg = 'Spotify session expired — reconnect your account') { super(msg); this.name = 'ReauthRequired'; } }
export class AuthError extends Error { constructor(msg: string) { super(msg); this.name = 'AuthError'; } }

export type Tokens = { access_token: string; refresh_token: string; expires_at: number; scope: string };
export type AuthDeps = { fetch: typeof fetch; store: SecureStore; redirectUri: string; now?: () => number; random?: (n: number) => Uint8Array };

const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
export async function pkceChallenge(verifier: string) { return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))); }

/** OAuth 2.0 Authorization Code + PKCE (no client secret, no passwords). */
export class SpotifyAuth {
  private now: () => number; private random: (n: number) => Uint8Array;
  private refreshing: Promise<Tokens> | null = null;
  constructor(private d: AuthDeps) { this.now = d.now ?? Date.now; this.random = d.random ?? rand; }

  async clientId() { return this.d.store.get(K.clientId); }
  async setClientId(id: string) { await this.d.store.set(K.clientId, id.trim()); }

  /** Step 1: build the authorize URL. Verifier + state are kept in secure storage until the redirect returns. */
  async begin(): Promise<string> {
    const clientId = await this.clientId();
    if (!clientId) throw new AuthError('Enter your Spotify Client ID first');
    const verifier = b64url(this.random(64)); const state = b64url(this.random(16));
    await this.d.store.set(K.pending, JSON.stringify({ verifier, state, at: this.now() }));
    const q = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: this.d.redirectUri, scope: SPOTIFY_SCOPES.join(' '),
      state, code_challenge_method: 'S256', code_challenge: await pkceChallenge(verifier) });
    return `${AUTH_URL}?${q}`;
  }

  /** Step 2: handle the redirect (rejects mismatched state = CSRF / stale flows, and user-denied access). */
  async complete(callbackUrl: string): Promise<Tokens> {
    const u = new URL(callbackUrl);
    const pendingRaw = await this.d.store.get(K.pending);
    await this.d.store.remove(K.pending); // single use
    if (!pendingRaw) throw new AuthError('No sign-in in progress');
    const pending = JSON.parse(pendingRaw) as { verifier: string; state: string; at: number };
    if (this.now() - pending.at > 10 * 60_000) throw new AuthError('Sign-in timed out — try again');
    const err = u.searchParams.get('error');
    if (err) throw new AuthError(err === 'access_denied' ? 'Access was denied' : `Spotify error: ${err}`);
    if (u.searchParams.get('state') !== pending.state) throw new AuthError('Sign-in rejected: state mismatch');
    const code = u.searchParams.get('code'); if (!code) throw new AuthError('No authorisation code returned');
    const clientId = (await this.clientId())!;
    return this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.d.redirectUri, client_id: clientId, code_verifier: pending.verifier }, null);
  }

  private async tokenRequest(body: Record<string, string>, prevRefresh: string | null): Promise<Tokens> {
    const r = await this.d.fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
    if (!r.ok) {
      let j: { error?: string; error_description?: string } = {}; try { j = await r.json(); } catch { /* ignore */ }
      if (body.grant_type === 'refresh_token' && (j.error === 'invalid_grant' || r.status === 400 || r.status === 401)) { await this.clear(); throw new ReauthRequired(); }
      throw new AuthError(`Token request failed (${r.status}) ${j.error_description ?? j.error ?? ''}`.trim());
    }
    const j = await r.json() as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
    const t: Tokens = { access_token: j.access_token, refresh_token: j.refresh_token ?? prevRefresh ?? '', expires_at: this.now() + j.expires_in * 1000, scope: j.scope ?? '' };
    await this.d.store.set(K.tokens, JSON.stringify(t));
    return t;
  }

  async tokens(): Promise<Tokens | null> { const r = await this.d.store.get(K.tokens); return r ? JSON.parse(r) as Tokens : null; }
  async isConnected() { return !!(await this.tokens()); }

  /** A valid access token; refreshes (once, shared by concurrent callers) when within 60 s of expiry. */
  async accessToken(force = false): Promise<string> {
    const t = await this.tokens(); if (!t) throw new ReauthRequired('Not connected to Spotify');
    if (!force && t.expires_at - this.now() > 60_000) return t.access_token;
    if (!t.refresh_token) { await this.clear(); throw new ReauthRequired(); }
    if (!this.refreshing) {
      // assign synchronously (no await before this) so concurrent callers share one refresh
      this.refreshing = (async () => {
        const clientId = (await this.clientId())!;
        return this.tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: clientId }, t.refresh_token);
      })().finally(() => { this.refreshing = null; });
    }
    return (await this.refreshing).access_token;
  }

  /** Forget credentials locally. (Spotify has no token-revocation endpoint — access can also be removed at spotify.com/account/apps.) */
  async clear() { await this.d.store.remove(K.tokens); await this.d.store.remove(K.pending); }
}
