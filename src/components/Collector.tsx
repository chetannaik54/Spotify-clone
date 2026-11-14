import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { catalogue, connectSpotify, disconnectSpotify, giveConsent, hasConsent, redirectUri, runSpotifyImport, spotifyAuth, useCollectorData, useCollectorUi } from '../lib/collector/service';
import { SPOTIFY_SCOPES } from '../lib/collector/spotify/auth';
import type { ImportedPlaylist, ImportedTrack, MatchingStatus } from '../lib/collector/types';
import { Art, fmt } from './Bits';
import Icon from './Icon';

const when = (t?: number | null) => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Never');
const LABEL: Record<MatchingStatus, string> = { pending_match: 'Not matched yet', matched: 'Matched', possible_match: 'Possible match', no_match: 'No match', download_permitted: 'Download permitted', downloading: 'Downloading', downloaded: 'Downloaded', unavailable: 'Unavailable', failed: 'Failed' };

export default function Collector() {
  const data = useCollectorData(); const ui = useCollectorUi();
  const liked = data.playlists.find(p => p.kind === 'liked' && p.source_platform === 'spotify');
  const lists = data.playlists.filter(p => p.kind === 'playlist');
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="view">
      <header className="hero"><h1>Playlist Collector</h1><p>Bring your playlists from Spotify and YouTube into one library. Only song details are imported — never audio.</p></header>

      <h2>Connected accounts</h2>
      <div className="acc-grid">
        <SpotifyCard acc={data.accounts.spotify} connected={!!ui.connected.spotify} busy={ui.busy.spotify} msg={ui.msg.spotify} reauth={!!ui.needsReauth.spotify} />
        <div className="acc-card dim"><div className="acc-h"><span className="brand yt">▶</span><div><b>YouTube</b><small>Coming in the next milestone</small></div></div>
          <p className="empty">Google sign-in, playlists and liked videos are not enabled yet.</p>
          <div className="acc-actions"><button className="chip" disabled>Connect Google / YouTube</button></div></div>
      </div>

      <h2>Imported playlists <small className="count">{lists.length}</small></h2>
      {!lists.length && <p className="empty">No playlists imported yet. Connect Spotify above and choose “Import playlists”.</p>}
      <div className="list">{lists.map(p => <PlaylistRow key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />)}</div>

      <h2>Liked songs <small className="count">{liked ? liked.entries.filter(e => !e.removed_at).length : 0}</small></h2>
      {liked ? <PlaylistRow p={liked} open={open === liked.id} onToggle={() => setOpen(open === liked.id ? null : liked.id)} /> : <p className="empty">Import your Spotify liked songs to see them here.</p>}

      <h2>Music matching</h2><StatusPanel tracks={data.tracks} note="Finding free, downloadable recordings in authorised catalogues arrives in the next milestone. Imported songs wait here as “Not matched yet”." />
      <h2>Download manager</h2>
      <section className="panel"><p className="empty">Downloads are not enabled yet. When they are, only recordings whose source explicitly permits downloading will be offered, and nothing downloads without your approval.</p>
        <div className="scan"><button className="chip" disabled>Download all eligible</button></div></section>

      <h2>Sync history</h2>
      {!data.syncs.length ? <p className="empty">No syncs yet.</p> : <div className="list">{data.syncs.slice(0, 10).map(s => (
        <div className="row static" key={s.id}><span className={`dot ${s.ok ? 'ok' : 'bad'}`} /><div className="meta"><b>Spotify · {s.ok ? 'completed' : 'failed'}</b>
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

function PlaylistRow({ p, open, onToggle }: { p: ImportedPlaylist; open: boolean; onToggle: () => void }) {
  const [tracks, setTracks] = useState<ImportedTrack[]>([]);
  useEffect(() => { if (open) catalogue.playlistTracks(p.id).then(setTracks); }, [open, p.id, p.updated_at]);
  const n = p.entries.filter(e => !e.removed_at).length;
  return (
    <div className="pl-block">
      <div className="row" onClick={onToggle}>
        <Art src={p.artwork_url} title={p.name} cls="row-art" />
        <div className="meta"><b>{p.name}</b><span>{p.kind === 'liked' ? 'Spotify liked songs' : `Spotify · ${p.owner}`} · {n}{p.total && p.total !== n ? ` of ${p.total}` : ''} songs · imported {when(p.imported_at)}</span>
          {p.last_error && <span className="err">{p.last_error}</span>}</div>
        {p.kind === 'playlist' && <label className="sel-box" onClick={e => e.stopPropagation()}><input type="checkbox" checked={p.selected} onChange={e => catalogue.setSelected(p.id, e.target.checked)} /> Sync</label>}
        <Icon n="down" size={20} />
      </div>
      {open && <div className="list nested">{tracks.map((t, i) => (
        <div className="row static" key={t.id + i}><span className="idx">{i + 1}</span><Art src={t.artwork_url} title={t.song_title} cls="row-art sm" />
          <div className="meta"><b>{t.song_title}</b><span>{t.artist_name}{t.album_name ? ` · ${t.album_name}` : ''}</span></div>
          <span className={`pill-s s-${t.matching_status}`}>{LABEL[t.matching_status]}</span><span className="dur">{t.duration_ms ? fmt(t.duration_ms / 1000) : ''}</span></div>))}
        {!tracks.length && <p className="empty">No songs.</p>}</div>}
    </div>
  );
}

function StatusPanel({ tracks, note }: { tracks: ImportedTrack[]; note: string }) {
  const counts = useMemo(() => { const c: Partial<Record<MatchingStatus, number>> = {}; tracks.forEach(t => { c[t.matching_status] = (c[t.matching_status] ?? 0) + 1; }); return c; }, [tracks]);
  return (
    <section className="panel"><div className="chips">
      <span className="chip">Imported songs <small>{tracks.length}</small></span>
      {(Object.keys(counts) as MatchingStatus[]).map(k => <span key={k} className="chip">{LABEL[k]} <small>{counts[k]}</small></span>)}</div>
      <p className="empty">{note}</p><div className="scan"><button className="chip" disabled>Find all matches</button></div></section>
  );
}
