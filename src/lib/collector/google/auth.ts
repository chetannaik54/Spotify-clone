import type { SecureStore } from '../secure';

export const YT_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';   // read-only: no uploads, no edits
const DEVICE_URL = 'https://oauth2.googleapis.com/device/code';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const K = { tokens: 'google.tokens', id: 'google.clientId', secret: 'google.clientSecret' };

export class GoogleReauthRequired extends Error { constructor(msg = 'Google session expired — reconnect your account') { super(msg); this.name = 'GoogleReauthRequired'; } }
export class GoogleAuthError extends Error { constructor(msg: string) { super(msg); this.name = 'GoogleAuthError'; } }

export type GTokens = { access_token: string; refresh_token: string; expires_at: number; scope: string };
export type DeviceCode = { device_code: string; user_code: string; verification_url: string; expires_at: number; interval: number };
export type GoogleDeps = { fetch: typeof fetch; store: SecureStore; now?: () => number; sleep?: (ms: number) => Promise<void> };

/**
 * Google OAuth "limited-input device" flow: the user types a short code at google.com/device. No redirect or deep link,
 * no password handled by Swarify. The OAuth client ID/secret belong to the user's own Google Cloud project; they are entered
 * at runtime and kept in encrypted storage (never in source code).
 */
export class GoogleAuth {
  private now: () => number; private sleep: (ms: number) => Promise<void>;
  private refreshing: Promise<GTokens> | null = null;
  constructor(private d: GoogleDeps) { this.now = d.now ?? Date.now; this.sleep = d.sleep ?? (ms => new Promise(r => setTimeout(r, ms))); }

  async setCredentials(id: string, secret: string) { await this.d.store.set(K.id, id.trim()); await this.d.store.set(K.secret, secret.trim()); }
  async credentials() { const [id, secret] = await Promise.all([this.d.store.get(K.id), this.d.store.get(K.secret)]); return id && secret ? { id, secret } : null; }
  async clientId() { return this.d.store.get(K.id); }

  private async post(url: string, body: Record<string, string>) {
    const r = await this.d.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
    let j: Record<string, unknown> = {}; try { j = await r.json(); } catch { /* non-JSON */ }
    return { r, j };
  }

  async startDeviceFlow(): Promise<DeviceCode> {
    const c = await this.credentials(); if (!c) throw new GoogleAuthError('Enter your Google OAuth Client ID and Client Secret first');
    const { r, j } = await this.post(DEVICE_URL, { client_id: c.id, scope: YT_SCOPE });
    if (!r.ok || !j.device_code) {
      const err = String(j.error ?? r.status);
      throw new GoogleAuthError(err === 'invalid_client' ? 'Google rejected the Client ID — check it was created as "TVs and Limited Input devices"' : err === 'invalid_scope' ? 'This OAuth client cannot request YouTube access' : `Could not start Google sign-in (${err})`);
    }
    return { device_code: String(j.device_code), user_code: String(j.user_code), verification_url: String(j.verification_url ?? j.verification_uri ?? 'https://www.google.com/device'), expires_at: this.now() + Number(j.expires_in ?? 1800) * 1000, interval: Number(j.interval ?? 5) };
  }

  /** Poll until the user approves on google.com/device. Handles pending / slow_down / denied / expired / cancelled. */
  async pollDeviceFlow(dc: DeviceCode, signal?: AbortSignal): Promise<GTokens> {
    const c = await this.credentials(); if (!c) throw new GoogleAuthError('Credentials missing');
    let interval = dc.interval;
    while (this.now() < dc.expires_at) {
      await this.sleep(interval * 1000);
      if (signal?.aborted) throw new GoogleAuthError('Sign-in cancelled');
      const { r, j } = await this.post(TOKEN_URL, { client_id: c.id, client_secret: c.secret, device_code: dc.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
      if (r.ok && j.access_token) return this.save(j as { access_token: string; refresh_token?: string; expires_in: number; scope?: string }, null);
      const err = String(j.error ?? '');
      if (err === 'authorization_pending') continue;
      if (err === 'slow_down') { interval += 5; continue; }
      if (err === 'access_denied') throw new GoogleAuthError('Access was denied');
      if (err === 'expired_token') throw new GoogleAuthError('The code expired — start again');
      throw new GoogleAuthError(`Google sign-in failed (${err || r.status}${j.error_description ? ': ' + j.error_description : ''})`);
    }
    throw new GoogleAuthError('The code expired — start again');
  }

  private async save(j: { access_token: string; refresh_token?: string; expires_in: number; scope?: string }, prevRefresh: string | null): Promise<GTokens> {
    const t: GTokens = { access_token: j.access_token, refresh_token: j.refresh_token ?? prevRefresh ?? '', expires_at: this.now() + j.expires_in * 1000, scope: j.scope ?? YT_SCOPE };
    await this.d.store.set(K.tokens, JSON.stringify(t)); return t;
  }
  async tokens(): Promise<GTokens | null> { const r = await this.d.store.get(K.tokens); return r ? JSON.parse(r) as GTokens : null; }
  async isConnected() { return !!(await this.tokens()); }

  async accessToken(force = false): Promise<string> {
    const t = await this.tokens(); if (!t) throw new GoogleReauthRequired('Not connected to Google');
    if (!force && t.expires_at - this.now() > 60_000) return t.access_token;
    if (!t.refresh_token) { await this.clear(); throw new GoogleReauthRequired(); }
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const c = await this.credentials(); if (!c) throw new GoogleReauthRequired();
        const { r, j } = await this.post(TOKEN_URL, { client_id: c.id, client_secret: c.secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' });
        if (!r.ok || !j.access_token) {
          if (j.error === 'invalid_grant' || r.status === 400 || r.status === 401) { await this.clear(); throw new GoogleReauthRequired('Google access expired or was revoked (apps in "Testing" mode lose access every 7 days) — reconnect'); }
          throw new GoogleAuthError(`Token refresh failed (${j.error ?? r.status})`);
        }
        return this.save(j as { access_token: string; expires_in: number; scope?: string }, t.refresh_token);
      })().finally(() => { this.refreshing = null; });
    }
    return (await this.refreshing).access_token;
  }

  /** Disconnect: revoke the grant at Google (best effort), then forget tokens locally. */
  async revoke(): Promise<boolean> {
    const t = await this.tokens(); let ok = !t;
    if (t) { try { const r = await this.d.fetch(REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t.refresh_token || t.access_token }) }); ok = r.ok; } catch { ok = false; } }
    await this.clear(); return ok;
  }
  async clear() { await this.d.store.remove(K.tokens); }
}
