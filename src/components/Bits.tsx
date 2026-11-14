import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Album, Playlist, Track } from '../lib/types';
import { addToPlaylist, addToQueue, current, newPlaylist, playList, toggleLike, useStore } from '../lib/store';
import { resolveSrc } from '../lib/scan';
import { go } from '../lib/nav';
import Icon from './Icon';

export const fmt = (s = 0) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Artwork with a branded fallback when there is no / broken image. */
export function Art({ src, title = '', cls = '' }: { src?: string; title?: string; cls?: string }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  if (!src || bad) return <div className={`art ph ${cls}`}><Icon n="note" size={28} /></div>;
  return <img className={`art ${cls}`} src={resolveSrc(src)} alt={title} loading="lazy" onError={() => setBad(true)} />;
}

function AddMenu({ t, onClose }: { t: Track; onClose: () => void }) {
  const pls = useStore(s => s.playlists);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const f = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); }; setTimeout(() => addEventListener('click', f), 0); return () => removeEventListener('click', f); }, [onClose]);
  return (
    <div className="menu" ref={ref} onClick={e => e.stopPropagation()}>
      <button onClick={() => { addToQueue(t, true); onClose(); }}>Play next</button>
      <button onClick={() => { addToQueue(t); onClose(); }}>Add to queue</button>
      <hr />
      {pls.map(p => <button key={p.id} onClick={() => { addToPlaylist(p.id, t); onClose(); }}>＋ {p.name}</button>)}
      <button onClick={() => { const n = prompt('Playlist name?'); if (n) { newPlaylist(n, [t]); } onClose(); }}>＋ New playlist…</button>
    </div>
  );
}

export function TrackRow({ t, list, i }: { t: Track; list: Track[]; i: number }) {
  const liked = useStore(s => s.liked.some(x => x.id === t.id));
  const playing = useStore(s => current(s)?.id === t.id);
  const [menu, setMenu] = useState(false);
  return (
    <div className={`row ${playing ? 'on' : ''}`} onClick={() => playList(list, i)}>
      <Art src={t.art} title={t.title} cls="row-art" />
      <div className="meta"><b>{t.title}</b><span>{t.artist}{t.preview ? ' · 30s preview' : ''}</span></div>
      <button className={`ic ${liked ? 'liked' : ''}`} aria-label="Like" onClick={e => { e.stopPropagation(); toggleLike(t); }}><Icon n="heart" size={20} fill={liked} /></button>
      <span className="dur">{t.duration ? fmt(t.duration) : ''}</span>
      <div className="menu-wrap">
        <button className="ic" aria-label="Add to…" onClick={e => { e.stopPropagation(); setMenu(m => !m); }}><Icon n="plus" size={20} /></button>
        {menu && <AddMenu t={t} onClose={() => setMenu(false)} />}
      </div>
    </div>
  );
}

export function TrackList({ tracks, limit }: { tracks: Track[]; limit?: number }) {
  const [n, setN] = useState(limit ?? 150);
  if (!tracks.length) return <p className="empty">Nothing here yet.</p>;
  return <div className="list">{tracks.slice(0, n).map((t, i) => <TrackRow key={t.id + i} t={t} list={tracks} i={i} />)}
    {tracks.length > n && <button className="chip" onClick={() => setN(n + 150)}>Show more ({tracks.length - n})</button>}</div>;
}

export function Card({ title, sub, art, onClick, round }: { title: string; sub?: string; art?: string; onClick: () => void; round?: boolean }) {
  return (
    <button className="card" onClick={onClick}>
      <div className="card-art"><Art src={art} title={title} cls={round ? 'round' : ''} /><i className="playbtn"><Icon n="play" size={18} /></i></div>
      <b className="t2">{title}</b><span className="t1">{sub}</span>
    </button>
  );
}
export const TrackCard = ({ t, list, i }: { t: Track; list: Track[]; i: number }) => <Card title={t.title} sub={t.artist} art={t.art} onClick={() => playList(list, i)} />;
export const AlbumCard = ({ a }: { a: Album }) => <Card title={a.title} sub={a.artist} art={a.art} onClick={() => go({ album: a })} />;
export const PlaylistCard = ({ p }: { p: Playlist }) => <Card title={p.name} sub={`${p.tracks.length} songs`} art={p.tracks[0]?.art} onClick={() => go({ tab: 'library', libSel: p.id, album: null })} />;

/** Horizontal scroll-snap carousel with desktop arrows. */
export function Carousel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const el = useRef<HTMLDivElement>(null);
  const by = (d: number) => el.current?.scrollBy({ left: d * el.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <section className="sec">
      <div className="sec-h"><h2>{title}</h2>{action}
        <span className="arrows"><button className="ic" aria-label="Scroll left" onClick={() => by(-1)}><Icon n="back" size={18} /></button>
          <button className="ic" aria-label="Scroll right" onClick={() => by(1)} style={{ transform: 'scaleX(-1)' }}><Icon n="back" size={18} /></button></span></div>
      <div className="hscroll" ref={el}>{children}</div>
    </section>
  );
}
export const sleepIn = (min: number | null) => import('../lib/store').then(m => m.set({ sleepAt: min ? Date.now() + min * 60000 : null }));
