import { describe, expect, it } from 'vitest';
import { AuthError, pkceChallenge, ReauthRequired, SpotifyAuth, SPOTIFY_SCOPES } from '../src/lib/collector/spotify/auth';
import { MemorySecureStore } from '../src/lib/collector/secure';
import { FakeSpotify } from './fakeSpotify';

const setup = (over: Partial<{ now: number }> = {}) => {
  const api = new FakeSpotify(); const store = new MemorySecureStore(); let now = over.now ?? 1_000_000;
  const auth = new SpotifyAuth({ fetch: api.fetch as typeof fetch, store, redirectUri: 'com.personal.swarify://auth/spotify', now: () => now });
  return { api, store, auth, tick: (ms: number) => { now += ms; } };
};
const cb = (state: string, code = 'GOODCODE') => `com.personal.swarify://auth/spotify?code=${code}&state=${state}`;
const stateOf = (url: string) => new URL(url).searchParams.get('state')!;

describe('Spotify OAuth (PKCE)', () => {
  it('S256 challenge matches the RFC 7636 test vector', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('requires a client id before starting', async () => { const { auth } = setup(); await expect(auth.begin()).rejects.toThrow(AuthError); });
  it('builds an authorize URL with minimal read-only scopes, S256, state and redirect — and no secret', async () => {
    const { auth } = setup(); await auth.setClientId('cid123'); const u = new URL(await auth.begin());
    expect(u.origin + u.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(u.searchParams.get('client_id')).toBe('cid123'); expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256'); expect(u.searchParams.get('code_challenge')!.length).toBeGreaterThan(40);
    expect(u.searchParams.get('redirect_uri')).toBe('com.personal.swarify://auth/spotify');
    expect(u.searchParams.get('scope')!.split(' ').sort()).toEqual([...SPOTIFY_SCOPES].sort());
    expect(u.searchParams.get('scope')).not.toMatch(/write|modify|streaming|email|private-read/); // read-only
    expect(u.searchParams.has('client_secret')).toBe(false);
  });
  it('exchanges the code with the PKCE verifier (no client_secret, no password) and stores tokens', async () => {
    const { auth, api, store } = setup(); await auth.setClientId('cid'); const state = stateOf(await auth.begin());
    const t = await auth.complete(cb(state));
    expect(t.access_token).toBe('AT1'); expect(await auth.isConnected()).toBe(true);
    const body = new URLSearchParams(api.tokenCalls[0].body);
    expect(body.get('code_verifier')!.length).toBeGreaterThanOrEqual(43); expect(body.get('client_id')).toBe('cid');
    expect([...body.keys()]).not.toContain('client_secret'); expect([...body.keys()]).not.toContain('password');
    expect(await store.get('spotify.pending')).toBeNull();                          // verifier is single-use
  });
  it('rejects state mismatch (CSRF), denial, replay, and stale flows', async () => {
    const a = setup(); await a.auth.setClientId('c'); await a.auth.begin();
    await expect(a.auth.complete(cb('WRONG'))).rejects.toThrow(/state mismatch/);
    expect(await a.auth.isConnected()).toBe(false);
    const b = setup(); await b.auth.setClientId('c'); const sb = stateOf(await b.auth.begin());
    await expect(b.auth.complete(`com.personal.swarify://auth/spotify?error=access_denied&state=${sb}`)).rejects.toThrow(/denied/);
    const c = setup(); await c.auth.setClientId('c'); const sc = stateOf(await c.auth.begin()); await c.auth.complete(cb(sc));
    await expect(c.auth.complete(cb(sc))).rejects.toThrow(/No sign-in in progress/);   // replay
    const d = setup(); await d.auth.setClientId('c'); const sd = stateOf(await d.auth.begin()); d.tick(11 * 60_000);
    await expect(d.auth.complete(cb(sd))).rejects.toThrow(/timed out/);
  });
  it('returns the cached token while fresh, refreshes near expiry, and keeps the refresh token when Spotify omits it', async () => {
    const { auth, api, tick } = setup(); await auth.setClientId('c'); await auth.complete(cb(stateOf(await auth.begin())));
    expect(await auth.accessToken()).toBe('AT1'); expect(api.tokenCalls.length).toBe(1);
    tick(3600_000 - 30_000);                                          // within the 60 s skew
    expect(await auth.accessToken()).toBe('AT2'); expect((await auth.tokens())!.refresh_token).toBe('RT1');
  });
  it('concurrent callers share a single refresh', async () => {
    const { auth, api, tick } = setup(); await auth.setClientId('c'); await auth.complete(cb(stateOf(await auth.begin())));
    tick(3600_000); const r = await Promise.all([auth.accessToken(), auth.accessToken(), auth.accessToken()]);
    expect(new Set(r).size).toBe(1); expect(api.tokenCalls.filter(c => /refresh_token/.test(c.body!)).length).toBe(1);
  });
  it('revoked refresh token → ReauthRequired and credentials are cleared', async () => {
    const { auth, api, tick } = setup(); await auth.setClientId('c'); await auth.complete(cb(stateOf(await auth.begin())));
    api.revoked = true; tick(3600_000);
    await expect(auth.accessToken()).rejects.toBeInstanceOf(ReauthRequired);
    expect(await auth.isConnected()).toBe(false);
  });
  it('disconnect clears tokens', async () => {
    const { auth, store } = setup(); await auth.setClientId('c'); await auth.complete(cb(stateOf(await auth.begin())));
    await auth.clear(); expect(await store.get('spotify.tokens')).toBeNull(); await expect(auth.accessToken()).rejects.toBeInstanceOf(ReauthRequired);
  });
});
