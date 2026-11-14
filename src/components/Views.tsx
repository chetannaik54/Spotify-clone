import { useEffect, useRef, useState } from 'react';
import { SHELVES, albumTracks, searchAlbums, searchAll, searchItunes } from '../lib/sources';
import type { Album, Track } from '../lib/types';
import { current, newPlaylist, playList, set, useStore } from '../lib/store';
import { go, useNav } from '../lib/nav';
import { importFiles, isNative, scanDevice } from '../lib/scan';
import { AlbumCard, Art, Carousel, PlaylistCard, TrackCard, TrackList, fmt } from './Bits';
import Icon from './Icon';

const tcache = new Map<string, Track[]>(); const acache = new Map<string, Album[]>();
const loadTracks = async (q: string) => { if (!tcache.has(q)) tcache.set(q, await searchItunes(q, 20).catch(() => [])); return tcache.get(q)!; };
const loadAlbums = async (q: string) => { if (!acache.has(q)) acache.set(q, await searchAlbums(q, 20).catch(() => [])); return acache.get(q)!; };

/** Renders its children once scrolled near the viewport, loading data lazily. */
function Lazy<T>({ load, title, render }: { load: () => Promise<T[]>; title: string; render: (d: T[]) => React.ReactNode }) {
  const [d, setD] = useState<T[] | null>(null); const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const o = new IntersectionObserver(([e]) => { if (e.isIntersecting) { load().then(setD); o.disconnect(); } }, { rootMargin: '400px' });
    o.observe(el.current!); return () => o.disconnect();
  }, []); // eslint-disable-line
  return <div ref={el}>{d === null ? <section className="sec"><div className="sec-h"><h2>{title}</h2></div><div className="skeleton" /></section> : d.length ? render(d) : null}</div>;
}

function Greeting() { const h = new Date().getHours(); return <>{h < 5 ? 'Late night vibes' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}</>; }

export function Home() {
  const recent = useStore(s => s.recent); const resume = useStore(s => s.resume); const playlists = useStore(s => s.playlists);
  const liked = useStore(s => s.liked); const local = useStore(s => s.local); const cur = useStore(s => current(s)); const playing = useStore(s => s.playing);
  return (
    <div className="view">
      <header className="hero"><h1><Greeting /></h1><p>What are we listening to today?</p></header>
      <div className="quick">
        <button onClick={() => go({ tab: 'library', libSel: 'liked' })}><span className="qi grad"><Icon n="heart" fill /></span><span className="qt"><b>Liked Songs</b><small>{liked.length} songs</small></span></button>
        <button onClick={() => go({ tab: 'library', libSel: 'local' })}><span className="qi"><Icon n="folder" /></span><span className="qt"><b>My Music</b><small>{local.length} on device</small></span></button>
        <button className="q-search" onClick={() => go({ tab: 'search' })}><span className="qi"><Icon n="search" /></span><span className="qt"><b>Search</b><small>Songs · artists</small></span></button>
      </div>

      {resume && <section className="sec"><div className="sec-h"><h2>Continue Listening</h2></div>
        <div className="resume" onClick={() => (cur?.id === resume.track.id ? set({ playing: !playing }) : playList([resume.track]))}>
          <Art src={resume.track.art} title={resume.track.title} cls="resume-art" />
          <div className="meta"><b>{resume.track.title}</b><span>{resume.track.artist}</span>
            <div className="bar"><i style={{ width: resume.dur ? `${Math.min(100, (resume.pos / resume.dur) * 100)}%` : '0%' }} /></div>
            <small>{fmt(resume.pos)} {resume.dur ? `/ ${fmt(resume.dur)}` : ''}</small></div>
          <span className="resume-btn"><Icon n={cur?.id === resume.track.id && playing ? 'pause' : 'play'} size={22} /></span>
        </div></section>}

      {recent.length > 0 && <Carousel title="Recently Played">{recent.map((t, i) => <TrackCard key={t.id} t={t} list={recent} i={i} />)}</Carousel>}

      <Carousel title="Your Playlists" action={<button className="link" onClick={() => { const n = prompt('Playlist name?'); if (n) newPlaylist(n); }}>＋ New</button>}>
        {playlists.length ? playlists.map(p => <PlaylistCard key={p.id} p={p} />)
          : <button className="card empty-card" onClick={() => { const n = prompt('Playlist name?'); if (n) newPlaylist(n); }}><div className="card-art"><div className="art ph"><Icon n="plus" size={32} /></div></div><b className="t2">Create your first playlist</b><span className="t1">Tap to start</span></button>}
      </Carousel>

      <Lazy title="Trending Music" load={() => loadTracks('Bollywood top hits')} render={t => <Carousel title="Trending Music">{t.map((x, i) => <TrackCard key={x.id} t={x} list={t} i={i} />)}</Carousel>} />
      <Lazy title="Recommended Albums" load={() => loadAlbums('Bollywood')} render={a => <Carousel title="Recommended Albums">{a.map(x => <AlbumCard key={x.id} a={x} />)}</Carousel>} />
      {SHELVES.map(s => <Lazy key={s.q} title={s.title} load={() => loadTracks(s.q)} render={t => <Carousel title={`${s.emoji} ${s.title}`}>{t.map((x, i) => <TrackCard key={x.id} t={x} list={t} i={i} />)}</Carousel>} />)}
    </div>
  );
}

export function AlbumView() {
  const album = useNav(n => n.album)!; const [tracks, setT] = useState<Track[] | null>(null);
  useEffect(() => { setT(null); albumTracks(album.id).then(setT).catch(() => setT([])); }, [album.id]);
  return (
    <div className="view">
      <button className="back" onClick={() => go({ album: null })}><Icon n="back" size={20} /> Back</button>
      <div className="album-h"><Art src={album.art} title={album.title} cls="album-art" />
        <div><small>ALBUM</small><h1>{album.title}</h1><p>{album.artist}</p>
          {tracks && tracks.length > 0 && <button className="big" onClick={() => playList(tracks, 0)}><Icon n="play" size={18} /> Play</button>}</div></div>
      {tracks === null ? <p className="empty">Loading…</p> : <TrackList tracks={tracks} />}
    </div>
  );
}

export function Search() {
  const [q, setQ] = useState(''); const [res, setRes] = useState<Track[]>([]); const [busy, setBusy] = useState(false);
  const jid = useStore(s => s.jamendoId); const local = useStore(s => s.local);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    setBusy(true); const h = setTimeout(() => searchAll(q, jid).then(setRes).finally(() => setBusy(false)), 400);
    return () => clearTimeout(h);
  }, [q, jid]);
  const needle = q.trim().toLowerCase();
  const mine = needle.length > 1 ? local.filter(t => (t.title + ' ' + t.artist + ' ' + (t.album ?? '')).toLowerCase().includes(needle)) : [];
  return (
    <div className="view">
      <h1>Search</h1>
      <div className="searchbox"><Icon n="search" size={20} /><input placeholder="Songs, artists, films…" value={q} onChange={e => setQ(e.target.value)} /></div>
      {!q && <div className="chips">{['Arijit Singh', 'Pritam', 'Atif Aslam', 'Sonu Nigam', 'Mohit Chauhan', 'Neha Kakkar', 'Jubin Nautiyal', 'Old Hindi songs'].map(c => <button className="chip" key={c} onClick={() => setQ(c)}>{c}</button>)}</div>}
      {mine.length > 0 && <><h2>On this device</h2><TrackList tracks={mine} limit={20} /></>}
      {busy && <p className="empty">Searching…</p>}
      {res.length > 0 && <><h2>Online</h2><TrackList tracks={res} /></>}
      {!busy && q.length > 1 && !res.length && !mine.length && <p className="empty">No results.</p>}
    </div>
  );
}

export function ScanButtons({ compact }: { compact?: boolean }) {
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const files = useRef<HTMLInputElement>(null); const dir = useRef<HTMLInputElement>(null);
  const run = async (f: () => Promise<number>) => { setBusy(true); setMsg('Scanning…'); try { setMsg(`Found ${await f()} songs ✓`); } catch (e: any) { setMsg(e?.message || 'Scan failed'); } setBusy(false); };
  return (
    <div className={compact ? 'scan compact' : 'scan'}>
      {isNative && <button className="big" disabled={busy} onClick={() => run(scanDevice)}><Icon n="scan" size={18} /> Scan device for music</button>}
      {!isNative && <button className="big" disabled={busy} onClick={() => dir.current?.click()}><Icon n="folder" size={18} /> Import folder</button>}
      {!isNative && <button className="chip" disabled={busy} onClick={() => files.current?.click()}>Pick files</button>}
      <input ref={files} type="file" accept="audio/*" multiple hidden onChange={e => e.target.files && run(() => importFiles(e.target.files!))} />
      <input ref={dir} type="file" multiple hidden {...({ webkitdirectory: '' } as object)} onChange={e => e.target.files && run(() => importFiles(e.target.files!))} />
      {msg && <span className="scan-msg">{msg}</span>}
    </div>
  );
}

export function Library() {
  const liked = useStore(s => s.liked); const playlists = useStore(s => s.playlists); const local = useStore(s => s.local);
  const sel = useNav(n => n.libSel) ?? 'liked'; const [folder, setFolder] = useState('');
  const tabs = [{ id: 'liked', name: 'Liked Songs', tracks: liked }, { id: 'local', name: 'My Music', tracks: local }, ...playlists.map(p => ({ id: p.id, name: p.name, tracks: p.tracks, offline: p.source ? p.tracks.filter(x => x.url).length : (null as number | null) }))];
  const cur = tabs.find(t => t.id === sel) ?? tabs[0];
  const folders = cur.id === 'local' ? [...local.reduce((m, t) => m.set(t.folder || 'Other', (m.get(t.folder || 'Other') ?? 0) + 1), new Map<string, number>())].sort((a, b) => a[0].localeCompare(b[0])) : [];
  const shown = cur.id === 'local' && folder ? cur.tracks.filter(t => (t.folder || 'Other') === folder) : cur.tracks;
  return (
    <div className="view">
      <h1>Your Library</h1>
      <div className="chips scrollx">{tabs.map(t => <button key={t.id} className={`chip ${t.id === cur.id ? 'sel' : ''}`} onClick={() => { go({ libSel: t.id }); setFolder(''); }}>{t.name} <small>{'offline' in t && t.offline != null ? `${t.offline}/${t.tracks.length}` : t.tracks.length}</small></button>)}
        <button className="chip" onClick={() => { const n = prompt('Playlist name?'); if (n) newPlaylist(n); }}>＋ Playlist</button></div>
      {cur.id === 'local' && <ScanButtons />}
      {folders.length > 1 && <div className="chips scrollx"><button className={`chip ${!folder ? 'sel' : ''}`} onClick={() => setFolder('')}>All folders</button>
        {folders.map(([f, n]) => <button key={f} className={`chip ${folder === f ? 'sel' : ''}`} onClick={() => setFolder(f)}><Icon n="folder" size={14} /> {f.split('/').filter(Boolean).slice(-2).join('/') || f} <small>{n}</small></button>)}</div>}
      {shown.length > 0 && <button className="big" onClick={() => playList(shown, 0)}><Icon n="play" size={18} /> Play all ({shown.length})</button>}
      {cur.id === 'local' && !local.length && <p className="empty">No local music yet. {isNative ? 'Tap “Scan device for music” to import every song on your tablet, all folders at once.' : 'Import a whole folder above.'}</p>}
      <TrackList tracks={shown} />
    </div>
  );
}

export function Settings() {
  const jid = useStore(s => s.jamendoId); const cf = useStore(s => s.crossfade);
  return (
    <div className="view narrow">
      <h1>Settings</h1>
      <section className="panel"><h2>Your music</h2><p className="empty">Scan the whole device once — every folder, including SD card.</p><ScanButtons /></section>
      <section className="panel"><h2>Playback</h2><label className="field">Crossfade: {cf ? `${cf}s` : 'off'}<input type="range" min={0} max={12} value={cf} onChange={e => set({ crossfade: +e.target.value })} /></label></section>
      <section className="panel"><h2>Online sources</h2><label className="field">Jamendo client ID (free full-length tracks)
        <input type="text" value={jid} onChange={e => set({ jamendoId: e.target.value.trim() })} placeholder="from developer.jamendo.com" /></label>
        <p className="empty">Apple previews are 30s. Full songs come from Jamendo, Internet Archive and your own files.</p></section>
    </div>
  );
}
