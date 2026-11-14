import { useEffect, useRef, useState } from 'react';
import { SHELVES, searchAll, searchItunes } from '../lib/sources';
import type { Track } from '../lib/types';
import { newPlaylist, playList, set, useStore } from '../lib/store';
import { putFile } from '../lib/db';
import { Card, TrackList } from './Bits';

const cache = new Map<string, Track[]>();
async function shelf(q: string) { if (!cache.has(q)) cache.set(q, await searchItunes(q, 20).catch(() => [])); return cache.get(q)!; }

export function Home() {
  const recent = useStore(s => s.recent);
  const hour = new Date().getHours();
  return (
    <div className="view">
      <h1>{hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'} 👋</h1>
      {recent.length > 0 && <Section title="Recently played 🕘" tracks={recent} />}
      {SHELVES.map(s => <Shelf key={s.q} title={`${s.emoji} ${s.title}`} q={s.q} />)}
    </div>
  );
}
function Section({ title, tracks }: { title: string; tracks: Track[] }) {
  return <section><h2>{title}</h2><div className="hscroll">{tracks.map((t, i) => <Card key={t.id} t={t} list={tracks} i={i} />)}</div></section>;
}
function Shelf({ title, q }: { title: string; q: string }) {
  const [tracks, setT] = useState<Track[] | null>(null);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => { // lazy-load when scrolled into view
    const o = new IntersectionObserver(([e]) => { if (e.isIntersecting) { shelf(q).then(setT); o.disconnect(); } }, { rootMargin: '300px' });
    o.observe(el.current!); return () => o.disconnect();
  }, [q]);
  return <div ref={el}>{tracks === null ? <section><h2>{title}</h2><div className="skeleton" /></section>
    : tracks.length ? <Section title={title} tracks={tracks} /> : null}</div>;
}

export function Search() {
  const [q, setQ] = useState(''); const [res, setRes] = useState<Track[]>([]); const [busy, setBusy] = useState(false);
  const jid = useStore(s => s.jamendoId);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    setBusy(true);
    const h = setTimeout(() => searchAll(q, jid).then(setRes).finally(() => setBusy(false)), 400);
    return () => clearTimeout(h);
  }, [q, jid]);
  return (
    <div className="view">
      <input className="search" autoFocus placeholder="Songs, artists, films…  e.g. Tum Hi Ho, Kishore Kumar" value={q} onChange={e => setQ(e.target.value)} />
      {busy && <p className="empty">Searching…</p>}
      <TrackList tracks={res} />
      {!q && <div className="chips">{['Arijit Singh', 'Pritam', 'Atif Aslam', 'Sonu Nigam', 'Mohit Chauhan', 'Neha Kakkar', 'Jubin Nautiyal', 'Old Hindi songs'].map(c => <button key={c} onClick={() => setQ(c)}>{c}</button>)}</div>}
    </div>
  );
}

export function Library() {
  const liked = useStore(s => s.liked); const playlists = useStore(s => s.playlists); const local = useStore(s => s.local);
  const [open, setOpen] = useState<string>('liked');
  const file = useRef<HTMLInputElement>(null);
  const importFiles = async (files: FileList | null) => {
    if (!files) return; const added: Track[] = [];
    for (const f of Array.from(files)) {
      const id = crypto.randomUUID(); await putFile(id, f);
      const m = f.name.replace(/\.[^.]+$/, '').split(' - ');
      added.push({ id: `lo-${id}`, title: m[m.length > 1 ? 1 : 0], artist: m.length > 1 ? m[0] : 'My Music', art: '/icon.svg', url: `local:${id}`, source: 'local' });
    }
    set(s => ({ local: [...added, ...s.local] }));
  };
  const tabs = [{ id: 'liked', name: '♥ Liked Songs', tracks: liked }, { id: 'local', name: '📁 My Files', tracks: local }, ...playlists.map(p => ({ id: p.id, name: p.name, tracks: p.tracks }))];
  const cur = tabs.find(t => t.id === open) ?? tabs[0];
  return (
    <div className="view">
      <h1>Your Library</h1>
      <div className="chips">
        {tabs.map(t => <button key={t.id} className={t.id === cur.id ? 'sel' : ''} onClick={() => setOpen(t.id)}>{t.name} ({t.tracks.length})</button>)}
        <button onClick={() => { const n = prompt('Playlist name?'); if (n) newPlaylist(n); }}>＋ New playlist</button>
        <button onClick={() => file.current?.click()}>⬆ Import music files</button>
        <input ref={file} type="file" accept="audio/*" multiple hidden onChange={e => importFiles(e.target.files)} />
      </div>
      {cur.tracks.length > 0 && <button className="big" onClick={() => playList(cur.tracks, 0)}>▶ Play all</button>}
      <TrackList tracks={cur.tracks} />
    </div>
  );
}

export function Settings() {
  const jid = useStore(s => s.jamendoId); const cf = useStore(s => s.crossfade);
  return (
    <div className="view">
      <h1>Settings</h1>
      <label className="field">Jamendo client ID (free full-length tracks)
        <input value={jid} onChange={e => set({ jamendoId: e.target.value.trim() })} placeholder="from developer.jamendo.com" /></label>
      <label className="field">Crossfade: {cf ? `${cf}s` : 'off'}
        <input type="range" min={0} max={12} value={cf} onChange={e => set({ crossfade: +e.target.value })} /></label>
      <p className="empty">Full-length Bollywood songs: import your own files in Library → “Import music files”. Free catalog sources provide 30-second previews (Apple) and full tracks (Jamendo, Internet Archive).</p>
    </div>
  );
}
