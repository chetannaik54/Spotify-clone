import { useEffect, useMemo, useRef, useState } from 'react';
import { current, set, step, toggleLike, useStore } from '../lib/store';
import { EQ_LABELS, seek, setEq, useTime } from '../lib/engine';
import { fetchLyrics } from '../lib/sources';
import { parseLrc, type Line } from '../lib/lrc';
import { getNav, go } from '../lib/nav';
import { Art, fmt, sleepIn } from './Bits';
import Icon from './Icon';

export function MiniBar() {
  const t = useStore(s => current(s)); const playing = useStore(s => s.playing); const { cur, dur } = useTime();
  if (!t) return null;
  const stop = (f: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); f(); };
  return (
    <div className="mini-bar" role="button" tabIndex={0} onClick={() => go({ full: true })} onKeyDown={e => e.key === 'Enter' && go({ full: true })}>
      <Art src={t.art} title={t.title} cls="mini-art" />
      <div className="meta"><b>{t.title}</b><span>{t.artist}</span></div>
      <button className="ic hide-sm" aria-label="Previous" onClick={stop(() => step(-1))}><Icon n="prev" /></button>
      <button className="ic round" aria-label={playing ? 'Pause' : 'Play'} onClick={stop(() => set({ playing: !playing }))}><Icon n={playing ? 'pause' : 'play'} size={20} /></button>
      <button className="ic" aria-label="Next" onClick={stop(() => step(1))}><Icon n="next" /></button>
      <div className="prog"><i style={{ width: dur ? `${(cur / dur) * 100}%` : 0 }} /></div>
    </div>
  );
}

export function NowPlaying() {
  const s = useStore(x => x); const t = current(s); const { cur, dur } = useTime();
  const [panel, setPanel] = useState<'lyrics' | 'queue' | 'eq' | null>(() => getNav().npPanel);
  useEffect(() => () => { go({ npPanel: null }); }, []);
  useEffect(() => { const f = (e: KeyboardEvent) => e.key === 'Escape' && go({ full: false }); addEventListener('keydown', f); return () => removeEventListener('keydown', f); }, []);
  if (!t) return null;
  const liked = s.liked.some(x => x.id === t.id);
  const tog = (p: 'lyrics' | 'queue' | 'eq') => setPanel(panel === p ? null : p);
  return (
    <div className="np" role="dialog" aria-label="Now playing">
      <header className="np-top"><button className="ic" aria-label="Close" onClick={() => go({ full: false })}><Icon n="down" size={26} /></button><span>NOW PLAYING</span>
        <button className={`ic ${liked ? 'liked' : ''}`} aria-label="Like" onClick={() => toggleLike(t)}><Icon n="heart" fill={liked} /></button></header>
      <div className={`np-body ${panel ? 'with-panel' : ''}`}>
        <div className="np-stage"><Art src={t.art} title={t.title} cls={`np-art ${s.playing ? 'live' : ''}`} /></div>
        <div className="np-controls">
          <div className="np-title"><h2>{t.title}</h2><p>{t.artist}{t.album ? ` · ${t.album}` : ''}</p></div>
          <input type="range" className="seek" aria-label="Seek" min={0} max={dur || 1} step={0.1} value={Math.min(cur, dur || 1)} style={{ '--p': `${dur ? (cur / dur) * 100 : 0}%` } as React.CSSProperties} onChange={e => seek(+e.target.value)} />
          <div className="times"><span>{fmt(cur)}</span><span>{fmt(dur)}</span></div>
          <div className="ctrl">
            <button className={`ic ${s.shuffle ? 'sel' : ''}`} aria-label="Shuffle" aria-pressed={s.shuffle} onClick={() => set({ shuffle: !s.shuffle })}><Icon n="shuffle" /></button>
            <button className="ic" aria-label="Previous" onClick={() => step(-1)}><Icon n="prev" size={28} /></button>
            <button className="ic play" aria-label={s.playing ? 'Pause' : 'Play'} onClick={() => set({ playing: !s.playing })}><Icon n={s.playing ? 'pause' : 'play'} size={30} /></button>
            <button className="ic" aria-label="Next" onClick={() => step(1)}><Icon n="next" size={28} /></button>
            <button className={`ic ${s.repeat !== 'off' ? 'sel' : ''}`} aria-label={`Repeat ${s.repeat}`} onClick={() => set({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' })}>
              <Icon n="repeat" />{s.repeat === 'one' && <sup>1</sup>}</button>
          </div>
          <div className="tools">
            <button className={`pill ${panel === 'lyrics' ? 'sel' : ''}`} onClick={() => tog('lyrics')}><Icon n="lyrics" size={16} /> Lyrics</button>
            <button className={`pill ${panel === 'queue' ? 'sel' : ''}`} onClick={() => tog('queue')}><Icon n="queue" size={16} /> Queue</button>
            <button className={`pill ${panel === 'eq' ? 'sel' : ''}`} onClick={() => tog('eq')}><Icon n="eq" size={16} /> EQ</button>
            <label className={`pill ${s.sleepAt ? 'sel' : ''}`}><Icon n="moon" size={16} />
              <select value="" onChange={e => sleepIn(+e.target.value || null)}><option value="">{s.sleepAt ? 'Sleep on' : 'Sleep'}</option><option value="0">Off</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">60 min</option></select></label>
            <label className="vol"><Icon n="volume" size={18} /><input type="range" aria-label="Volume" min={0} max={1} step={0.02} value={s.volume} style={{ '--p': `${s.volume * 100}%` } as React.CSSProperties} onChange={e => set({ volume: +e.target.value })} /></label>
          </div>
        </div>
        {panel && <aside className="np-panel">
          <div className="panel-h" role="tablist">{(['lyrics', 'queue', 'eq'] as const).map(k => <button key={k} role="tab" aria-selected={panel === k} className={panel === k ? 'sel' : ''} onClick={() => setPanel(k)}>{k === 'eq' ? 'EQ' : k[0].toUpperCase() + k.slice(1)}</button>)}
            <button className="ic" aria-label="Close panel" onClick={() => setPanel(null)}><Icon n="down" size={20} /></button></div>
          <div className="panel-b">{panel === 'lyrics' ? <Lyrics /> : panel === 'queue' ? <Queue /> : <Eq />}</div></aside>}
      </div>
    </div>
  );
}

function Lyrics() {
  const t = useStore(s => current(s))!; const { cur } = useTime();
  const [raw, setRaw] = useState<string | null | undefined>(undefined); const box = useRef<HTMLDivElement>(null);
  useEffect(() => { setRaw(undefined); fetchLyrics(t).then(setRaw); }, [t.id]); // eslint-disable-line
  const lines: Line[] | null = useMemo(() => (raw ? parseLrc(raw) : null), [raw]);
  const idx = lines ? lines.findLastIndex(l => l.t <= cur + 0.2) : -1;
  useEffect(() => { box.current?.querySelector('.hot')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [idx]);
  if (raw === undefined) return <p className="empty">Loading lyrics…</p>;
  if (!raw) return <p className="empty">No lyrics found for this song.</p>;
  return <div className="lyrics" ref={box}>{lines ? lines.map((l, i) => <p key={i} className={i === idx ? 'hot' : ''} onClick={() => seek(l.t)}>{l.text || '♪'}</p>) : <pre>{raw}</pre>}</div>;
}
function Queue() {
  const queue = useStore(s => s.queue); const index = useStore(s => s.index);
  return <div className="list"><h3>Up next · {queue.length}</h3>{queue.map((t, i) => <div key={t.id + i} className={`row ${i === index ? 'on' : ''}`} onClick={() => set({ index: i, playing: true })}><Art src={t.art} title={t.title} cls="row-art" /><div className="meta"><b>{t.title}</b><span>{t.artist}</span></div></div>)}</div>;
}
function Eq() {
  const eq = useStore(s => s.eq);
  const presets: Record<string, number[]> = { Flat: [0, 0, 0, 0, 0], 'Bass Boost': [8, 5, 0, 0, 0], Vocal: [-2, 0, 4, 3, 0], Treble: [0, 0, 0, 5, 8], Bollywood: [5, 2, 1, 3, 4] };
  return <div className="eq"><div className="chips">{Object.entries(presets).map(([n, v]) => <button className="chip" key={n} onClick={() => v.forEach((g, i) => setEq(i, g))}>{n}</button>)}</div>
    <div className="bands">{EQ_LABELS.map((l, i) => <label key={l}><input type="range" className="vert" aria-label={l} min={-12} max={12} value={eq[i]} onChange={e => setEq(i, +e.target.value)} /><span>{l}</span></label>)}</div></div>;
}
