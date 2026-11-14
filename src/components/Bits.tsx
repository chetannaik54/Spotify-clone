import type { Track } from '../lib/types';
import { addToQueue, addToPlaylist, current, getState, playList, toggleLike, useStore } from '../lib/store';

export const fmt = (s = 0) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function Art({ t, size = 56 }: { t: Track; size?: number }) {
  return <img className="art" src={t.art} width={size} height={size} loading="lazy" alt=""
    onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />;
}

export function TrackRow({ t, list, i }: { t: Track; list: Track[]; i: number }) {
  const liked = useStore(s => s.liked.some(x => x.id === t.id));
  const playing = useStore(s => current(s)?.id === t.id);
  const pls = useStore(s => s.playlists);
  return (
    <div className={`row ${playing ? 'on' : ''}`} onClick={() => playList(list, i)}>
      <Art t={t} size={48} />
      <div className="meta"><b>{t.title}</b><span>{t.artist}{t.preview ? ' · 30s preview' : ''}</span></div>
      <button className="ic" title="Play next" onClick={e => { e.stopPropagation(); addToQueue(t, true); }}>⏭︎</button>
      {pls.length > 0 && <select className="mini" value="" onClick={e => e.stopPropagation()} onChange={e => { addToPlaylist(e.target.value, t); }}>
        <option value="">＋ List</option>{pls.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      <button className={`ic ${liked ? 'liked' : ''}`} onClick={e => { e.stopPropagation(); toggleLike(t); }}>{liked ? '♥' : '♡'}</button>
      <span className="dur">{t.duration ? fmt(t.duration) : ''}</span>
    </div>
  );
}

export function TrackList({ tracks }: { tracks: Track[] }) {
  if (!tracks.length) return <p className="empty">Nothing here yet.</p>;
  return <div className="list">{tracks.map((t, i) => <TrackRow key={t.id + i} t={t} list={tracks} i={i} />)}</div>;
}

export function Card({ t, list, i }: { t: Track; list: Track[]; i: number }) {
  return (
    <div className="card" onClick={() => playList(list, i)}>
      <Art t={t} size={170} /><b>{t.title}</b><span>{t.artist}</span><i className="playbtn">▶</i>
    </div>
  );
}
export const sleepIn = (min: number | null) => import('../lib/store').then(m => m.set({ sleepAt: min ? Date.now() + min * 60000 : null }));
export { getState };
