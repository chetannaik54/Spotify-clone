import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cancelYouTubeConnect, catalogue, connectSpotify, connectYouTube, disconnectSpotify, disconnectYouTube, giveConsent, googleAuth, hasConsent, importCsv, redirectUri, runSpotifyImport, runYouTubeImport, spotifyAuth, useCollectorData, useCollectorUi } from '../lib/collector/service';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { SPOTIFY_SCOPES } from '../lib/collector/spotify/auth';
import type { ImportedPlaylist, ImportedTrack, MatchingStatus } from '../lib/collector/types';
import { Art, fmt } from './Bits';
import Matching from './Matching';
import Downloads from './Downloads';
import { displayName } from '../lib/collector/playlistNames';
import Icon from './Icon';

const when = (t?: number | null) => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Never');
const PLATFORM: Record<string, string> = { spotify: 'Spotify', youtube: 'YouTube', csv: 'CSV' };
const LABEL: Record<MatchingStatus, string> = { pending_match: 'Not matched yet', matched: 'Matched', possible_match: 'Possible match', no_match: 'No match', download_permitted: 'Download permitted', downloading: 'Downloading', downloaded: 'Downloaded', unavailable: 'Unavailable', failed: 'Failed' };

export default function Collector() {
  const data = useCollectorData(); const ui = useCollectorUi();
  const likedLists = data.playlists.filter(p => p.kind === 'liked');
  const rev = useMemo(() => data.tracks.reduce((m, t) => Math.max(m, t.updated_at), 0), [data.tracks]);   // bumps whenever any song changes
  const lists = data.playlists.filter(p => p.kind === 'playlist');
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="view">
      <header className="hero"><h1>Playlist Collector</h1><p>Bring your playlists from Spotify and YouTube into one library. Only song details are imported — never audio.</p></header>

      <h2>Connected accounts</h2>
      <div className="acc-grid">
        <SpotifyCard acc={data.accounts.spotify} connected={!!ui.connected.spotify} busy={ui.busy.spotify} msg={ui.msg.spotify} reauth={!!ui.needsReauth.spotify} />
        <YouTubeCard acc={data.accounts.youtube} connected={!!ui.connected.youtube} busy={ui.busy.youtube} msg={ui.msg.youtube} reauth={!!ui.needsReauth.youtube} device={ui.device.youtube} />
        <CsvCard msg={ui.msg.csv} />
      </div>

      <h2>Imported playlists <small className="count">{lists.length}</small></h2>
      {!lists.length && <p className="empty">No playlists imported yet. Connect Spotify above and choose “Import playlists”.</p>}
      <div className="list">{lists.map(p => <PlaylistRow key={p.id} p={p} rev={rev} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />)}</div>

      <h2>Liked songs <small className="count">{likedLists.reduce((n, p) => n + p.entries.filter(e => !e.removed_at).length, 0)}</small></h2>
      {likedLists.length ? likedLists.map(l => <PlaylistRow key={l.id} p={l} rev={rev} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)} />) : <p className="empty">Import your Spotify liked songs or YouTube liked videos to see them here.</p>}

      <h2>Music matching</h2><Matching tracks={data.tracks} matches={data.matches} playlists={data.playlists} />
      <h2>Download manager</h2><Downloads tracks={data.tracks} playlists={data.playlists} />

      <h2>Sync history</h2>
      {!data.syncs.length ? <p className="empty">No syncs yet.</p> : <div className="list">{data.syncs.slice(0, 10).map(s => (
        <div className="row static" key={s.id}><span className={`dot ${s.ok ? 'ok' : 'bad'}`} /><div className="meta"><b>{PLATFORM[s.platform]} · {s.ok ? 'completed' : 'failed'}</b>
          <span>{when(s.started_at)} · {s.playlists} lists · {s.tracks_added} new · {s.tracks_updated} updated</span>
          {s.errors.slice(0, 3).map((e, i) => <span key={i} className="err">{e}</span>)}</div></div>))}</div>}
    </div>
  );
}

function SpotifyCard({ acc, connected, busy, msg, reauth }: { acc?: { display_name: string; last_synced_at: number | null }; connected: boolean; busy?: string; msg?: { kind: 'ok' | 'err'; text: string }; reauth: boolean }) {
  const [clientId, setClientId] = useState(''); const [saved, setSaved] = useState(false); const [consent, setConsent] = useState(false); const [confirm, setConfirm] = useState(false);
  useEffect(() => { spotifyAuth.clientId().then(v => { if (v) { setClientId(v); setSaved(true); } }); }, []);
  const start = () => (hasConsent('spotify') ? connectSpotify() : setConsent(true));
  return (
    <div className="acc-card">
      <div className="acc-h"><span className="brand sp">♫</span><div><b>Spotify</b>
        <small>{reauth ? 'Session expired — reconnect' : connected ? `Connected${acc ? ` as ${acc.display_name}` : ''}` : 'Not connected'}</small></div>
        <span className={`dot ${connected && !reauth ? 'ok' : 'bad'}`} /></div>
      {connected && <p className="empty">Last synchronised: {when(acc?.last_synced_at)}</p>}
      {!connected || reauth ? (<>
        <label className="field">Spotify Client ID <input type="text" value={clientId} placeholder="from developer.spotify.com/dashboard" onChange={e => { setClientId(e.target.value); setSaved(false); }} /></label>
        <details className="help"><summary>Setup (once)</summary>
          <ol><li>Create an app at developer.spotify.com/dashboard.</li><li>Add this exact Redirect URI:<code>{redirectUri('spotify')}</code></li><li>Paste the app’s Client ID above. No secret is needed or stored.</li></ol>
          <p>Permissions requested (read-only): {SPOTIFY_SCOPES.join(', ')}.</p></details>
        <div className="acc-actions">
          <button className="chip" disabled={!clientId.trim() || saved} onClick={async () => { await spotifyAuth.setClientId(clientId); setSaved(true); }}>Save ID</button>
          <button className="big" disabled={!saved || !!busy} onClick={start}><Icon n="collect" size={18} /> {reauth ? 'Reconnect Spotify' : 'Connect Spotify'}</button>
        </div></>) : (
        <div className="acc-actions">
          <button className="big" disabled={!!busy} onClick={() => runSpotifyImport({ playlists: true, liked: false })}>Import playlists</button>
          <button className="chip" disabled={!!busy} onClick={() => runSpotifyImport({ playlists: false, liked: true })}>Import liked songs</button>
          <button className="chip" disabled={!!busy} onClick={() => runSpotifyImport({ onlySelected: true })}>Sync selected</button>
          <button className="chip" disabled={!!busy} onClick={() => setConfirm(true)}>Disconnect</button>
        </div>)}
      {busy && <p className="busy"><span className="spin" />{busy}</p>}
      {msg && <p className={msg.kind === 'ok' ? 'okmsg' : 'errmsg'}>{msg.text}</p>}
      {consent && <Modal onClose={() => setConsent(false)} title="Before you connect Spotify">
        <ul className="bullets"><li>Swarify reads your <b>playlist names, song titles, artists, albums, artwork and durations</b>, plus your liked songs. It never sees your password.</li>
          <li>This stays on this device. Nothing is uploaded to a Swarify server (there isn’t one).</li>
          <li>Spotify audio is <b>never</b> downloaded or copied. Spotify details are used only to look for separately licensed, downloadable recordings.</li>
          <li>In a later step, song <b>titles and artists only</b> (not your account or playlist names) are sent to music catalogues such as Jamendo and Internet Archive — you will be asked again first.</li>
          <li>You can disconnect at any time. Tokens are stored encrypted in Android Keystore-backed storage.</li></ul>
        <div className="acc-actions"><button className="chip" onClick={() => setConsent(false)}>Cancel</button><button className="big" onClick={() => { giveConsent('spotify'); setConsent(false); connectSpotify(); }}>I understand, continue</button></div></Modal>}
      {confirm && <Modal onClose={() => setConfirm(false)} title="Disconnect Spotify?">
        <p className="empty">This removes your tokens from this device. Spotify also lets you revoke access at spotify.com/account/apps.</p>
        <div className="acc-actions"><button className="chip" onClick={() => setConfirm(false)}>Cancel</button>
          <button className="chip" onClick={async () => { await disconnectSpotify(false); setConfirm(false); }}>Disconnect, keep imported songs</button>
          <button className="chip danger" onClick={async () => { await disconnectSpotify(true); setConfirm(false); }}>Disconnect and remove imported data</button></div></Modal>}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const f = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, [onClose]);
  // portal: ancestors with backdrop-filter would otherwise trap position:fixed inside the card
  return createPortal(<div className="modal-bg" onClick={onClose}><div className="modal" role="dialog" aria-label={title} onClick={e => e.stopPropagation()}><h2>{title}</h2>{children}</div></div>, document.body);
}

function PlaylistRow({ p, open, onToggle, rev }: { p: ImportedPlaylist; open: boolean; onToggle: () => void; rev: number }) {
  const [tracks, setTracks] = useState<ImportedTrack[]>([]);
  useEffect(() => { if (open) catalogue.playlistTracks(p.id).then(setTracks); }, [open, p.id, p.updated_at, rev]);
  const n = p.entries.filter(e => !e.removed_at).length;
  return (
    <div className="pl-block">
      <div className="row" onClick={onToggle}>
        <Art src={p.artwork_url} title={p.name} cls="row-art" />
        <div className="meta"><b>{displayName(p)}</b><span><i className={`src-pill sp-${p.source_platform}`}>{p.kind === 'liked' ? `${PLATFORM[p.source_platform]} liked` : PLATFORM[p.source_platform]}</i> {n}{p.total && p.total !== n ? ` of ${p.total}` : ''} songs · {p.owner ? `${p.owner} · ` : ''}imported {when(p.imported_at)}</span>
          {p.last_error && <span className="err">{p.last_error}</span>}</div>
        <button className="ic" aria-label="Rename playlist" title="Rename" onClick={e => { e.stopPropagation(); const n = prompt('Playlist name', displayName(p)); if (n !== null) catalogue.renamePlaylist(p.id, n); }}>✎</button>
        {p.kind === 'playlist' && <label className="sel-box" onClick={e => e.stopPropagation()}><input type="checkbox" checked={p.selected} onChange={e => catalogue.setSelected(p.id, e.target.checked)} /> Sync</label>}
        <Icon n="down" size={20} />
      </div>
      {open && <div className="list nested">{tracks.map((t, i) => (
        <div className="row static" key={t.id + i}><span className="idx">{i + 1}</span><Art src={t.artwork_url} title={t.song_title} cls="row-art sm" />
          <div className="meta"><b>{t.song_title}</b><span>{t.artist_name || t.channel || 'Unknown artist'}{t.album_name ? ` · ${t.album_name}` : ''}</span></div>
          {t.import_status === 'not_music'
            ? <><span className="pill-s s-no_match" title={`Song confidence ${Math.round((t.music_confidence ?? 0) * 100)}%`}>Not a song</span><button className="chip mini-chip" onClick={() => catalogue.setMusicOverride(t.id, true)}>It’s a song</button></>
            : <><span className={`pill-s s-${t.matching_status}`}>{t.import_status === 'unavailable' ? 'Unavailable' : LABEL[t.matching_status]}</span>{t.source_platform === 'youtube' && t.import_status === 'imported' && (t.user_override ? <button className="chip mini-chip" onClick={() => catalogue.setMusicOverride(t.id, false)}>Undo</button> : (t.music_confidence ?? 1) < 0.75 && <button className="chip mini-chip" onClick={() => catalogue.setMusicOverride(t.id, false)}>Not a song</button>)}</>}<span className="dur">{t.duration_ms ? fmt(t.duration_ms / 1000) : ''}</span></div>))}
        {!tracks.length && <p className="empty">No songs.</p>}</div>}
    </div>
  );
}

function YouTubeCard({ acc, connected, busy, msg, reauth, device }: { acc?: { display_name: string; last_synced_at: number | null }; connected: boolean; busy?: string; msg?: { kind: 'ok' | 'err'; text: string }; reauth: boolean; device?: { code: string; url: string; expiresAt: number } }) {
  const [cid, setCid] = useState(''); const [secret, setSecret] = useState(''); const [saved, setSaved] = useState(false); const [consent, setConsent] = useState(false); const [confirm, setConfirm] = useState(false);
  useEffect(() => { googleAuth.credentials().then(c => { if (c) { setCid(c.id); setSecret(c.secret); setSaved(true); } }); }, []);
  const start = () => (hasConsent('youtube') ? connectYouTube() : setConsent(true));
  const openGoogle = () => (Capacitor.isNativePlatform() ? Browser.open({ url: device?.url ?? 'https://www.google.com/device' }) : window.open(device?.url ?? 'https://www.google.com/device', '_blank'));
  return (
    <div className="acc-card">
      <div className="acc-h"><span className="brand yt">▶</span><div><b>YouTube</b><small>{reauth ? 'Session expired — reconnect' : connected ? `Connected${acc ? ` as ${acc.display_name}` : ''}` : 'Not connected'}</small></div><span className={`dot ${connected && !reauth ? 'ok' : 'bad'}`} /></div>
      {connected && !reauth && <p className="empty">Last synchronised: {when(acc?.last_synced_at)}</p>}
      {device ? (
        <div className="device-box">
          <p className="empty">1. Open <b>google.com/device</b> &nbsp; 2. Enter this code &nbsp; 3. Approve read-only access</p>
          <div className="device-code" aria-label="Google device code">{device.code}</div>
          <div className="acc-actions"><button className="big" onClick={openGoogle}>Open google.com/device</button><button className="chip" onClick={cancelYouTubeConnect}>Cancel</button></div>
        </div>
      ) : !connected || reauth ? (<>
        <label className="field">OAuth Client ID <input type="text" value={cid} placeholder="….apps.googleusercontent.com" onChange={e => { setCid(e.target.value); setSaved(false); }} /></label>
        <label className="field">OAuth Client secret <input type="password" value={secret} placeholder="GOCSPX-…" autoComplete="off" onChange={e => { setSecret(e.target.value); setSaved(false); }} /></label>
        <details className="help"><summary>Setup (once, in your own Google Cloud project)</summary>
          <ol><li>console.cloud.google.com → create a project → <b>APIs &amp; Services → Library → YouTube Data API v3 → Enable</b>.</li>
            <li><b>OAuth consent screen</b>: External, add your Google account under <b>Test users</b>.</li>
            <li><b>Credentials → Create credentials → OAuth client ID</b> → application type <b>“TVs and Limited Input devices”</b>.</li>
            <li>Paste the Client ID and secret above. They are stored encrypted on this device only.</li></ol>
          <p>Permission requested: <code>youtube.readonly</code> (read-only). While the consent screen is in “Testing”, Google expires access every 7 days — just reconnect.</p></details>
        <div className="acc-actions">
          <button className="chip" disabled={!cid.trim() || !secret.trim() || saved} onClick={async () => { await googleAuth.setCredentials(cid, secret); setSaved(true); }}>Save credentials</button>
          <button className="big" disabled={!saved || !!busy} onClick={start}><Icon n="collect" size={18} /> {reauth ? 'Reconnect YouTube' : 'Connect Google / YouTube'}</button>
        </div></>) : (
        <div className="acc-actions">
          <button className="big" disabled={!!busy} onClick={() => runYouTubeImport({ playlists: true, liked: false })}>Import playlists</button>
          <button className="chip" disabled={!!busy} onClick={() => runYouTubeImport({ playlists: false, liked: true })}>Import liked videos</button>
          <button className="chip" disabled={!!busy} onClick={() => runYouTubeImport({ onlySelected: true })}>Sync selected</button>
          <button className="chip" disabled={!!busy} onClick={() => setConfirm(true)}>Disconnect</button>
        </div>)}
      {busy && !device && <p className="busy"><span className="spin" />{busy}</p>}
      {msg && <p className={msg.kind === 'ok' ? 'okmsg' : 'errmsg'}>{msg.text}</p>}
      {consent && <Modal onClose={() => setConsent(false)} title="Before you connect YouTube">
        <ul className="bullets"><li>Swarify reads your <b>playlists, the videos in them, and your liked videos</b> (title, channel, thumbnail, length). It cannot change anything and never sees your Google password.</li>
          <li>Everything stays on this device. Nothing is uploaded to a Swarify server.</li>
          <li>YouTube audio is <b>never</b> downloaded or extracted. Only video details are used, to look for separately licensed downloadable recordings.</li>
          <li>Not every video is a song. Swarify scores each one and flags the rest as “Not a song” — you can override it.</li>
          <li>You can disconnect at any time; Swarify also asks Google to revoke its access.</li></ul>
        <div className="acc-actions"><button className="chip" onClick={() => setConsent(false)}>Cancel</button><button className="big" onClick={() => { giveConsent('youtube'); setConsent(false); connectYouTube(); }}>I understand, continue</button></div></Modal>}
      {confirm && <Modal onClose={() => setConfirm(false)} title="Disconnect YouTube?">
        <p className="empty">Swarify will revoke its access at Google and remove the tokens from this device.</p>
        <div className="acc-actions"><button className="chip" onClick={() => setConfirm(false)}>Cancel</button>
          <button className="chip" onClick={async () => { await disconnectYouTube(false); setConfirm(false); }}>Disconnect, keep imported songs</button>
          <button className="chip danger" onClick={async () => { await disconnectYouTube(true); setConfirm(false); }}>Disconnect and remove imported data</button></div></Modal>}
    </div>
  );
}

function CsvCard({ msg }: { msg?: { kind: 'ok' | 'err'; text: string } }) {
  const f = useRef<HTMLInputElement>(null);
  return (
    <div className="acc-card">
      <div className="acc-h"><span className="brand csv">⇪</span><div><b>CSV playlists</b><small>No account needed</small></div></div>
      <p className="empty">Have a playlist exported to CSV (for example with Exportify)? Import it here. Needs a song-title column; artist, album, duration and Spotify track links are used when present.</p>
      <div className="acc-actions"><button className="big" onClick={() => f.current?.click()}>Import CSV files</button></div>
      <input ref={f} type="file" accept=".csv,text/csv" multiple hidden onChange={e => { if (e.target.files?.length) importCsv(e.target.files); e.target.value = ''; }} />
      {msg && <p className={msg.kind === 'ok' ? 'okmsg' : 'errmsg'}>{msg.text}</p>}
    </div>
  );
}
