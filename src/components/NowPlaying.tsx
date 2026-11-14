import { useEffect, useMemo, useRef, useState } from 'react';
import { current, getState, set, step, toggleLike, useStore } from '../lib/store';
import { EQ_LABELS, seek, setEq, useTime } from '../lib/engine';
import { fetchLyrics } from '../lib/sources';
import { parseLrc, type Line } from '../lib/lrc';
import { Art, fmt, sleepIn } from './Bits';

export function MiniBar({ onOpen }: { onOpen: () => void }) {
  const t = useStore(s => current(s)); const playing = useStore(s => s.playing); const { cur, dur } = useTime();
  if (!t) return null;
  return (
    <div className="mini-bar" onClick={onOpen}>
      <div className="prog" style={{ width: dur ? `${(cur / dur) * 100}%` : 0 }} />
      <Art t={t} size={48} /><div className="meta"><b>{t.title}</b><span>{t.artist}</span></div>
      <button className="ic" onClick={e => { e.stopPropagation(); step(-1); }}>⏮</button>
      <button className="ic big" onClick={e => { e.stopPropagation(); set({ playing: !playing }); }}>{playing ? '⏸' : '▶'}</button>
      <button className="ic" onClick={e => { e.stopPropagation(); step(1); }}>⏭</button>
    </div>
  );
}

export function NowPlaying({ onClose }: { onClose: () => void }) {
  const s = useStore(x => x); const t = current(s); const { cur, dur } = useTime();
  const [panel, setPanel] = useState<'lyrics' | 'queue' | 'eq' | null>(null);
  if (!t) return null;
  const liked = s.liked.some(x => x.id === t.id);
  return (
    <div className="np">
      <button className="ic close" onClick={onClose}>⌄</button>
      <div className="np-main">
        <img className="np-art" src={t.art} alt="" style={{ animationPlayState: s.playing ? 'running' : 'paused' }} />
        <div className="np-side">
          <h2>{t.title}</h2><p>{t.artist}</p>
          <input type="range" className="seek" min={0} max={dur || 1} step={0.1} value={cur} onChange={e => seek(+e.target.value)} />
          <div className="times"><span>{fmt(cur)}</span><span>{fmt(dur)}</span></div>
          <div className="ctrl">
            <button className={`ic ${s.shuffle ? 'sel' : ''}`} onClick={() => set({ shuffle: !s.shuffle })}>🔀</button>
            <button className="ic" onClick={() => step(-1)}>⏮</button>
            <button className="ic play" onClick={() => set({ playing: !s.playing })}>{s.playing ? '⏸' : '▶'}</button>
            <button className="ic" onClick={() => step(1)}>⏭</button>
            <button className={`ic ${s.repeat !== 'off' ? 'sel' : ''}`} onClick={() => set({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' })}>{s.repeat === 'one' ? '🔂' : '🔁'}</button>
          </div>
          <div className="ctrl small">
            <button className={`ic ${liked ? 'liked' : ''}`} onClick={() => toggleLike(t)}>{liked ? '♥' : '♡'}</button>
            <button className={`pill ${panel === 'lyrics' ? 'sel' : ''}`} onClick={() => setPanel(panel === 'lyrics' ? null : 'lyrics')}>Lyrics</button>
            <button className={`pill ${panel === 'queue' ? 'sel' : ''}`} onClick={() => setPanel(panel === 'queue' ? null : 'queue')}>Queue</button>
            <button className={`pill ${panel === 'eq' ? 'sel' : ''}`} onClick={() => setPanel(panel === 'eq' ? null : 'eq')}>EQ</button>
            <select className="pill" value="" onChange={e => sleepIn(+e.target.value || null)}>
              <option value="">{s.sleepAt ? '😴 on' : '😴 Sleep'}</option><option value="0">Off</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">60 min</option></select>
            <label className="vol">🔊<input type="range" min={0} max={1} step={0.02} value={s.volume} onChange={e => set({ volume: +e.target.value })} /></label>
          </div>
        </div>
        {panel && <div className="np-panel">{panel === 'lyrics' ? <Lyrics /> : panel === 'queue' ? <Queue /> : <Eq />}</div>}
      </div>
    </div>
  );
}

function Lyrics() {
  const t = useStore(s => current(s))!; const { cur } = useTime();
  const [raw, setRaw] = useState<string | null | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { setRaw(undefined); fetchLyrics(t).then(setRaw); }, [t.id]);
  const lines: Line[] | null = useMemo(() => (raw ? parseLrc(raw) : null), [raw]);
  const idx = lines ? lines.findLastIndex(l => l.t <= cur + 0.2) : -1;
  useEffect(() => { box.current?.querySelector('.hot')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [idx]);
  if (raw === undefined) return <p className="empty">Loading lyrics…</p>;
  if (!raw) return <p className="empty">No lyrics found.</p>;
  return <div className="lyrics" ref={box}>{lines ? lines.map((l, i) => <p key={i} className={i === idx ? 'hot' : ''} onClick={() => seek(l.t)}>{l.text || '♪'}</p>) : <pre>{raw}</pre>}</div>;
}
function Queue() {
  const queue = useStore(s => s.queue); const index = useStore(s => s.index);
  return <div className="list">{queue.map((t, i) => <div key={t.id + i} className={`row ${i === index ? 'on' : ''}`} onClick={() => set({ index: i, playing: true })}><Art t={t} size={40} /><div className="meta"><b>{t.title}</b><span>{t.artist}</span></div></div>)}</div>;
}
function Eq() {
  const eq = useStore(s => s.eq);
  const presets: Record<string, number[]> = { Flat: [0, 0, 0, 0, 0], 'Bass Boost': [8, 5, 0, 0, 0], Vocal: [-2, 0, 4, 3, 0], Treble: [0, 0, 0, 5, 8], Bollywood: [5, 2, 1, 3, 4] };
  return <div className="eq"><div className="chips">{Object.entries(presets).map(([n, v]) => <button key={n} onClick={() => v.forEach((g, i) => setEq(i, g))}>{n}</button>)}</div>
    <div className="bands">{EQ_LABELS.map((l, i) => <label key={l}><input type="range" className="vert" min={-12} max={12} value={eq[i]} onChange={e => setEq(i, +e.target.value)} /><span>{l}</span></label>)}</div></div>;
}
void getState;
