import { useEffect, useState, useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Catalogue, idbStores } from './catalogue';
import { importSpotify } from './importer';
import { secureStore } from './secure';
import { ReauthRequired, SpotifyAuth } from './spotify/auth';
import { SpotifyClient } from './spotify/client';
import type { AccountMeta, ImportedPlaylist, ImportedTrack, Platform, SyncRecord } from './types';

export const catalogue = new Catalogue(idbStores());
export const isNativeApp = Capacitor.isNativePlatform();
/** Must be registered exactly in the Spotify developer dashboard. */
export const redirectUri = (p: Platform) => (isNativeApp ? `com.personal.swarify://auth/${p}` : `${location.origin}/`);
export const spotifyAuth = new SpotifyAuth({ fetch: (...a) => fetch(...a), store: secureStore, redirectUri: redirectUri('spotify') });
const spotifyClient = new SpotifyClient({ fetch: (...a) => fetch(...a), auth: spotifyAuth });

// ---- transient UI state (busy / messages) ----
type Ui = { busy: Partial<Record<Platform, string>>; msg: Partial<Record<Platform, { kind: 'ok' | 'err'; text: string }>>; needsReauth: Partial<Record<Platform, boolean>>; connected: Partial<Record<Platform, boolean>> };
let ui: Ui = { busy: {}, msg: {}, needsReauth: {}, connected: {} };
const subs = new Set<() => void>();
const setUi = (f: (u: Ui) => Ui) => { ui = f(ui); subs.forEach(s => s()); };
export const useCollectorUi = () => useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => ui);
const say = (p: Platform, kind: 'ok' | 'err', text: string) => setUi(u => ({ ...u, msg: { ...u.msg, [p]: { kind, text } } }));

// ---- consent (shown before any account is connected) ----
const consentKey = (p: Platform) => `swarify.consent.${p}`;
export const hasConsent = (p: Platform) => { try { return localStorage.getItem(consentKey(p)) === '1'; } catch { return false; } };
export const giveConsent = (p: Platform) => { try { localStorage.setItem(consentKey(p), '1'); } catch { /* ignore */ } };

export async function refreshConnection() {
  const c = await spotifyAuth.isConnected();
  setUi(u => ({ ...u, connected: { ...u.connected, spotify: c } }));
}

export async function connectSpotify() {
  try {
    const url = await spotifyAuth.begin();
    if (isNativeApp) await Browser.open({ url }); else location.assign(url);
  } catch (e) { say('spotify', 'err', (e as Error).message); }
}

/** Called with the redirect URL (deep link on Android, page URL on web). */
export async function handleCallback(url: string) {
  if (!/[?&](code|error)=/.test(url)) return false;
  setUi(u => ({ ...u, busy: { ...u.busy, spotify: 'Finishing sign-in…' } }));
  try {
    if (isNativeApp) Browser.close().catch(() => {});
    await spotifyAuth.complete(url);
    setUi(u => ({ ...u, needsReauth: { ...u.needsReauth, spotify: false } }));
    await refreshConnection();
    say('spotify', 'ok', 'Connected to Spotify');
    await runSpotifyImport({});
  } catch (e) { say('spotify', 'err', (e as Error).message); }
  finally { setUi(u => ({ ...u, busy: { ...u.busy, spotify: undefined } })); }
  return true;
}

export async function runSpotifyImport(o: { playlists?: boolean; liked?: boolean; onlySelected?: boolean }) {
  if (ui.busy.spotify && !/sign-in/.test(ui.busy.spotify)) return;
  setUi(u => ({ ...u, busy: { ...u.busy, spotify: 'Starting…' } }));
  try {
    const r = await importSpotify(spotifyClient, catalogue, { ...o, onProgress: (m, d, t) => setUi(u => ({ ...u, busy: { ...u.busy, spotify: `${m} (${d}/${t})` } })) });
    say('spotify', r.errors.length ? 'err' : 'ok', `Imported ${r.playlists} lists · ${r.tracks_added} new songs${r.errors.length ? ` · ${r.errors.length} problem(s), see Sync History` : ''}`);
  } catch (e) {
    if (e instanceof ReauthRequired) { setUi(u => ({ ...u, needsReauth: { ...u.needsReauth, spotify: true } })); await refreshConnection(); }
    say('spotify', 'err', (e as Error).message);
  } finally { setUi(u => ({ ...u, busy: { ...u.busy, spotify: undefined } })); }
}

export async function disconnectSpotify(purge: boolean) {
  await spotifyAuth.clear(); await catalogue.removeAccount('spotify', purge);
  setUi(u => ({ ...u, needsReauth: { ...u.needsReauth, spotify: false }, msg: { ...u.msg, spotify: { kind: 'ok', text: 'Disconnected. Tokens removed from this device.' } } }));
  await refreshConnection();
}

/** Wire deep links (Android) / page-load redirect (web). Call once at startup. */
export function initCollector() {
  refreshConnection();
  if (isNativeApp) App.addListener('appUrlOpen', ({ url }) => { if (url.startsWith('com.personal.swarify://auth/spotify')) handleCallback(url); });
  else if (/[?&](code|error)=/.test(location.search) && /[?&]state=/.test(location.search)) { handleCallback(location.href).then(() => history.replaceState({}, '', location.pathname)); }
}

// ---- data hook ----
export type CollectorData = { accounts: Partial<Record<Platform, AccountMeta | undefined>>; playlists: ImportedPlaylist[]; tracks: ImportedTrack[]; syncs: SyncRecord[] };
export function useCollectorData(): CollectorData {
  const [d, setD] = useState<CollectorData>({ accounts: {}, playlists: [], tracks: [], syncs: [] });
  useEffect(() => {
    let live = true;
    const load = async () => { const [sp, playlists, tracks, syncs] = await Promise.all([catalogue.account('spotify'), catalogue.playlists(), catalogue.tracks(), catalogue.syncs()]); if (live) setD({ accounts: { spotify: sp }, playlists, tracks, syncs }); };
    load(); const off = catalogue.subscribe(load);
    return () => { live = false; off(); };
  }, []);
  return d;
}
