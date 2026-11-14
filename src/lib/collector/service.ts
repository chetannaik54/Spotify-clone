import { useEffect, useState, useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Catalogue, idbStores } from './catalogue';
import { friendly, friendlyYt, importCsvFiles, importSpotify, importYouTube } from './importer';
import { GoogleAuth, GoogleReauthRequired, YT_SCOPE, type DeviceCode } from './google/auth';
import { YouTubeClient } from './youtube/client';
import { httpFetch } from '../http';
import { getState, set as setStore } from '../store';
import { buildMirror, mergeMirror } from './mirror';
import { DownloadManager } from './download/manager';
import { NativeTransport, hasNativeDownloader } from './download/native';
import { WebTransport } from './download/web';
import type { DownloadJob } from './download/types';
import type { Track } from '../types';
import { confirmMatch, matchMany, rejectMatch, skipTrack, type RunProgress } from './match/engine';
import { ArchiveSource } from './match/sources/archive';
import { JamendoSource } from './match/sources/jamendo';
import { LocalSource } from './match/sources/local';
import { SoundCloudSource } from './match/sources/soundcloud';
import type { MatchRecord, MatchSource } from './match/types';
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
export const googleAuth = new GoogleAuth({ fetch: (...a) => httpFetch(...a), store: secureStore });
const youtubeClient = new YouTubeClient({ fetch: (...a) => httpFetch(...a), auth: googleAuth });
void YT_SCOPE;

// ---- transient UI state (busy / messages) ----
type Ui = { review: boolean; match: { running: boolean; progress: RunProgress | null; note: string }; device: Partial<Record<Platform, { code: string; url: string; expiresAt: number }>>; busy: Partial<Record<Platform, string>>; msg: Partial<Record<Platform, { kind: 'ok' | 'err'; text: string }>>; needsReauth: Partial<Record<Platform, boolean>>; connected: Partial<Record<Platform, boolean>> };
let ui: Ui = { review: false, match: { running: false, progress: null, note: '' }, device: {}, busy: {}, msg: {}, needsReauth: {}, connected: {} };
const subs = new Set<() => void>();
const setUi = (f: (u: Ui) => Ui) => { ui = f(ui); subs.forEach(s => s()); };
export const useCollectorUi = () => useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => ui);
const say = (p: Platform, kind: 'ok' | 'err', text: string) => setUi(u => ({ ...u, msg: { ...u.msg, [p]: { kind, text } } }));

// ---- consent (shown before any account is connected) ----
const consentKey = (p: Platform) => `swarify.consent.${p}`;
export const hasConsent = (p: Platform) => { try { return localStorage.getItem(consentKey(p)) === '1'; } catch { return false; } };
export const giveConsent = (p: Platform) => { try { localStorage.setItem(consentKey(p), '1'); } catch { /* ignore */ } };

export async function refreshConnection() {
  let c = false, y = false;
  try { c = await spotifyAuth.isConnected(); y = await googleAuth.isConnected(); } catch (e) { console.warn('secure storage unavailable', e); }
  setUi(u => ({ ...u, connected: { ...u.connected, spotify: c, youtube: y } }));
}

// ---------------- YouTube (Google device flow) ----------------
let deviceAbort: AbortController | null = null;
export async function connectYouTube() {
  deviceAbort?.abort(); deviceAbort = new AbortController(); const signal = deviceAbort.signal;
  setUi(u => ({ ...u, busy: { ...u.busy, youtube: 'Contacting Google…' }, msg: { ...u.msg, youtube: undefined } }));
  try {
    const dc: DeviceCode = await googleAuth.startDeviceFlow();
    setUi(u => ({ ...u, device: { ...u.device, youtube: { code: dc.user_code, url: dc.verification_url, expiresAt: dc.expires_at } }, busy: { ...u.busy, youtube: 'Waiting for you to approve on Google…' } }));
    await googleAuth.pollDeviceFlow(dc, signal);
    setUi(u => ({ ...u, device: { ...u.device, youtube: undefined }, needsReauth: { ...u.needsReauth, youtube: false } }));
    await refreshConnection(); say('youtube', 'ok', 'Connected to YouTube');
    setUi(u => ({ ...u, busy: { ...u.busy, youtube: undefined } }));
    await runYouTubeImport({});
  } catch (e) { say('youtube', 'err', (e as Error).message); setUi(u => ({ ...u, device: { ...u.device, youtube: undefined } })); }
  finally { setUi(u => ({ ...u, busy: ui.busy.youtube && /Importing|Starting/.test(ui.busy.youtube) ? u.busy : { ...u.busy, youtube: undefined } })); }
}
export function cancelYouTubeConnect() { deviceAbort?.abort(); setUi(u => ({ ...u, device: { ...u.device, youtube: undefined }, busy: { ...u.busy, youtube: undefined } })); }

export async function runYouTubeImport(o: { playlists?: boolean; liked?: boolean; onlySelected?: boolean }) {
  if (ui.busy.youtube && /Importing|Starting/.test(ui.busy.youtube)) return;
  setUi(u => ({ ...u, busy: { ...u.busy, youtube: 'Starting…' } }));
  try {
    const r = await importYouTube(youtubeClient, catalogue, { ...o, onProgress: (m, d, t) => setUi(u => ({ ...u, busy: { ...u.busy, youtube: `${m} (${d}/${t})` } })) });
    say('youtube', r.errors.length ? 'err' : 'ok', `Imported ${r.playlists} lists · ${r.tracks_added} new videos${r.errors.length ? ` · ${r.errors.length} problem(s), see Sync History` : ''}`);
  } catch (e) {
    if (e instanceof GoogleReauthRequired) { setUi(u => ({ ...u, needsReauth: { ...u.needsReauth, youtube: true } })); await refreshConnection(); }
    say('youtube', 'err', e instanceof GoogleReauthRequired ? e.message : (e as Error).message.startsWith('YouTube refused') ? (e as Error).message : friendlyYt(e));
  } finally { setUi(u => ({ ...u, busy: { ...u.busy, youtube: undefined } })); }
}

export async function disconnectYouTube(purge: boolean) {
  const revoked = await googleAuth.revoke(); await catalogue.removeAccount('youtube', purge);
  setUi(u => ({ ...u, needsReauth: { ...u.needsReauth, youtube: false }, msg: { ...u.msg, youtube: { kind: 'ok', text: revoked ? 'Disconnected. Google access was revoked and tokens removed.' : 'Disconnected locally. Could not reach Google to revoke — remove access at myaccount.google.com/permissions.' } } }));
  await refreshConnection();
}

// ---------------- CSV ----------------
export async function importCsv(files: FileList | File[]) {
  const list = await Promise.all(Array.from(files).map(async f => ({ name: f.name, text: await f.text() })));
  const r = await importCsvFiles(catalogue, list);
  setUi(u => ({ ...u, msg: { ...u.msg, csv: { kind: r.errors.length ? 'err' : 'ok', text: `Imported ${r.playlists} playlist(s) · ${r.tracks_added} new songs${r.errors.length ? ` · ${r.errors.join(' | ')}` : ''}` } } }));
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
    say('spotify', 'err', e instanceof ReauthRequired ? e.message : (e as Error).message.startsWith('Spotify signed you in') ? (e as Error).message : friendly(e));
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
  catalogue.subscribe(mirrorNow); mirrorNow();
  downloads.recover().catch(() => {}); setInterval(() => downloads.tick().catch(() => {}), 15000); addEventListener('online', () => downloads.tick().catch(() => {}));
  if (isNativeApp) App.addListener('appUrlOpen', ({ url }) => { if (url.startsWith('com.personal.swarify://auth/spotify')) handleCallback(url); }).catch(e => console.warn('deep-link listener failed', e));
  else if (/[?&](code|error)=/.test(location.search) && /[?&]state=/.test(location.search)) { handleCallback(location.href).then(() => history.replaceState({}, '', location.pathname)); }
}

// ---- data hook ----
export type CollectorData = { matches: MatchRecord[]; accounts: Partial<Record<Platform, AccountMeta | undefined>>; playlists: ImportedPlaylist[]; tracks: ImportedTrack[]; syncs: SyncRecord[] };
export function useCollectorData(): CollectorData {
  const [d, setD] = useState<CollectorData>({ matches: [], accounts: {}, playlists: [], tracks: [], syncs: [] });
  useEffect(() => {
    let live = true;
    const load = async () => { const [sp, yt, playlists, tracks, syncs, matches] = await Promise.all([catalogue.account('spotify'), catalogue.account('youtube'), catalogue.playlists(), catalogue.tracks(), catalogue.syncs(), catalogue.matches()]); if (live) setD({ accounts: { spotify: sp, youtube: yt }, playlists, tracks, syncs, matches }); };
    load(); const off = catalogue.subscribe(load);
    return () => { live = false; off(); };
  }, []);
  return d;
}


// ---------------- Matching (Milestone 3) ----------------
export const hasMatchConsent = () => hasConsent('matching' as Platform);
export const giveMatchConsent = () => giveConsent('matching' as Platform);
let matchAbort: AbortController | null = null;

/** Local files always; network catalogues only after the user's consent and only when enabled (and keyed where a key is needed). */
export function buildSources(): MatchSource[] {
  const st = getState(); const out: MatchSource[] = [new LocalSource({ tracks: () => getState().local })];
  if (!hasMatchConsent()) return out;
  if (st.matchSources.jamendo && st.jamendoId) out.push(new JamendoSource({ fetch: (...a) => httpFetch(...a), clientId: st.jamendoId }));
  if (st.matchSources.archive) out.push(new ArchiveSource({ fetch: (...a) => httpFetch(...a) }));
  if (st.matchSources.soundcloud && st.soundcloudId) out.push(new SoundCloudSource({ fetch: (...a) => httpFetch(...a), clientId: st.soundcloudId }));
  return out;
}
const setMatchUi = (m: Partial<Ui['match']>) => setUi(u => ({ ...u, match: { ...u.match, ...m } }));

export async function runMatching(filter: (t: ImportedTrack) => boolean = () => true, force = false) {
  if (ui.match.running) return;
  const sources = buildSources(); matchAbort = new AbortController();
  setMatchUi({ running: true, progress: { done: 0, total: 0, current: '', failed: 0 }, note: sources.length === 1 ? 'Only your own device is searched until you allow online catalogues.' : '' });
  try {
    const tracks = (await catalogue.tracks()).filter(filter);
    const r = await matchMany(catalogue, tracks, { sources, force, signal: matchAbort.signal, concurrency: 2, onProgress: p => setMatchUi({ progress: p }) });
    if (getState().dl.auto) {            // opt-in only: exact, verified, auto-selected matches
      const ids: string[] = []; for (const t of await catalogue.tracks()) { const m = await catalogue.getMatch(t.id); if (m?.selected_by === 'auto' && (await downloads.eligibility(t)).ok) ids.push(t.id); }
      if (ids.length) await downloads.enqueue(ids);
    }
    setMatchUi({ note: `Checked ${r.done} songs${r.failed ? ` · ${r.failed} could not be searched (network) — use “Retry failed”` : ''}${matchAbort.signal.aborted ? ' · stopped' : ''}` });
  } catch (e) { setMatchUi({ note: (e as Error).message }); }
  finally { setMatchUi({ running: false }); }
}
export const stopMatching = () => matchAbort?.abort();
export const retryFailedMatches = () => runMatching(t => t.matching_status === 'failed');
export async function confirmSelectedMatches(trackIds: string[]) { for (const id of trackIds) { const r = await catalogue.getMatch(id); const best = r?.candidates[0]; if (best && !r?.selected) await confirmMatch(catalogue, id, best.key); } }
export async function skipUnavailable() { for (const t of await catalogue.tracks()) if (t.import_status === 'imported' && (t.matching_status === 'no_match' || t.matching_status === 'failed')) await skipTrack(catalogue, t.id); }
export { confirmMatch, rejectMatch, skipTrack };


// ---------------- Download manager (Milestone 4) ----------------
export const downloads = new DownloadManager({
  cat: catalogue, transport: hasNativeDownloader ? new NativeTransport() : new WebTransport(),
  settings: () => getState().dl, localTracks: () => getState().local,
  registerLocal: (t: Track) => { setStore(s => ({ local: [t, ...s.local.filter(x => x.id !== t.id)] })); mirrorNow(); },
});
export function useDownloadJobs(): DownloadJob[] {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  useEffect(() => { let live = true; const load = () => downloads.jobs().then(j => { if (live) setJobs(j); }); load(); const off = downloads.subscribe(load); return () => { live = false; off(); }; }, []);
  return jobs;
}

// ---------------- Mirrored Swarify playlists (Phase 8) ----------------
let mirrorTimer: ReturnType<typeof setTimeout> | null = null;
export function mirrorNow() {
  if (mirrorTimer) clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(async () => {
    try { const [pls, tracks] = await Promise.all([catalogue.playlists(), catalogue.tracks()]); setStore(s => ({ playlists: mergeMirror(s.playlists, buildMirror(pls, tracks, s.local)) })); } catch (e) { console.warn('playlist mirror failed', e); }
  }, 250);
}
export const setReview = (open: boolean) => setUi(u => ({ ...u, review: open }));
