import { useMemo, useState } from 'react';
import { CATEGORIES, KIND_LABEL, addItem, byKind, catOf, resolveItems, suggestCategory, type AudioCategory, type AudioKind } from '../lib/journey/library';
import { playList, set, useStore } from '../lib/store';
import type { Track } from '../lib/types';
import { Art, fmt } from './Bits';

const INTRO: Record<AudioKind, string> = {
  story: 'Mystery, horror, comedy, romance, thrillers and short stories — from audio files stored on this device. Add your own audiobooks or downloaded, licensed audio.',
  podcast: 'Episodes you have saved on this device. Playback position is remembered per episode.',
  sleep: 'Rain, ocean, nature, ambient music and guided relaxation from files on this device, with a sleep timer that fades out gently. No sleep audio is bundled — add your own or properly licensed files.',
};

export default function JourneyAudio({ kind, onBack }: { kind: AudioKind; onBack: () => void }) {
  const local = useStore(s => s.local); const lib = useStore(s => s.audioLib); const prog = useStore(s => s.audioProgress);
  const cats = CATEGORIES.filter(c => c.kind === kind); const [cat, setCat] = useState<AudioCategory | 'all'>('all'); const [q, setQ] = useState(''); const [assign, setAssign] = useState<AudioCategory>(cats[0].id);
  const items = useMemo(() => byKind(resolveItems(lib, local), kind), [lib, local, kind]);
  const shown = items.filter(r => cat === 'all' || r.item.category === cat);
  const inLib = new Set(lib.map(i => i.trackId));
  const suggestions = useMemo(() => local.filter(t => !inLib.has(t.id)).map(t => ({ t, c: suggestCategory(t) })).filter((x): x is { t: Track; c: AudioCategory } => !!x.c && catOf(x.c).kind === kind), [local, lib, kind]); // eslint-disable-line
  const results = useMemo(() => (q.trim().length > 1 ? local.filter(t => !inLib.has(t.id) && `${t.title} ${t.album ?? ''} ${t.artist}`.toLowerCase().includes(q.toLowerCase())).slice(0, 12) : []), [q, local, lib]); // eslint-disable-line
  const add = (t: Track, c: AudioCategory) => set(s => ({ audioLib: addItem(s.audioLib, t.id, c) }));
  const play = (list: Track[], i: number) => { const t = list[i]; const p = prog[t.id]; if (p && p.pos > 5 && (!p.dur || p.pos < p.dur - 10)) set({ startAt: { id: t.id, pos: p.pos } }); playList(list, i); };
  const [sleepMin, setSleepMin] = useState(60);
  const startSleep = () => { const list = shown.filter(r => r.track && !r.missing).map(r => r.track!); if (!list.length) return; const reps = Math.ceil((sleepMin * 60) / Math.max(60, list.reduce((n, t) => n + (t.duration ?? 600), 0))); const queue = Array.from({ length: Math.min(reps, 40) }, () => list).flat(); set({ crossfade: 4, repeat: 'all', shuffle: false, sleepAt: Date.now() + sleepMin * 60000 }); playList(queue, 0); };
  return (
    <div className="view">
      <button className="back" onClick={onBack}>← Journey</button><h1>{KIND_LABEL[kind]}</h1><p className="empty">{INTRO[kind]}</p>
      <div className="chips scrollx"><button className={`chip ${cat === 'all' ? 'sel' : ''}`} onClick={() => setCat('all')}>All <small>{items.length}</small></button>{cats.map(c => <button key={c.id} className={`chip ${cat === c.id ? 'sel' : ''}`} onClick={() => setCat(c.id)}>{c.label} <small>{items.filter(r => r.item.category === c.id).length}</small></button>)}</div>
      {kind === 'sleep' && <section className="panel"><h2>Sleep journey</h2><p className="empty">Plays the {cat === 'all' ? 'sounds below' : catOf(cat as AudioCategory).label.toLowerCase()} on repeat with a 4 s crossfade, then fades out over 30 s and stops. The timer runs inside the Android player, so it works with the screen locked.</p>
        <div className="chips">{[15, 30, 60, 120, 480].map(m => <button key={m} className={`chip ${sleepMin === m ? 'sel' : ''}`} onClick={() => setSleepMin(m)}>{m < 60 ? `${m} min` : `${m / 60} h`}</button>)}</div>
        <div className="acc-actions"><button className="big" disabled={!shown.some(r => !r.missing)} onClick={startSleep}>🌙 Start sleep journey</button></div></section>}
      {!shown.length && <p className="empty">Nothing here yet. Add files from your device below.</p>}
      <div className="list">{shown.map((r, i) => { const t = r.track; const p = t ? prog[t.id] : undefined; const pct = p?.dur ? Math.min(100, (p.pos / p.dur) * 100) : 0; return (
        <div className={`row ${r.missing ? 'unavail' : ''}`} key={r.item.id} onClick={() => t && !r.missing && play(shown.filter(x => x.track && !x.missing).map(x => x.track!), shown.filter(x => x.track && !x.missing).findIndex(x => x.item.id === r.item.id))}>
          <Art src={t?.art} title={t?.title} cls="row-art" /><div className="meta"><b>{t?.title ?? 'Missing file'}</b><span>{r.missing ? 'File not found on this device' : `${t!.album && t!.album !== 'Unknown' ? t!.album + ' · ' : ''}${catOf(r.item.category).label}${t!.duration ? ' · ' + fmt(t!.duration) : ''}${p ? ` · ${Math.round(pct)}% played` : ''}`}</span>{pct > 0 && <div className="bar"><i style={{ width: `${pct}%` }} /></div>}</div>
          <button className="chip mini-chip" onClick={e => { e.stopPropagation(); set(s => ({ audioLib: s.audioLib.filter(x => x.id !== r.item.id) })); }}>Remove</button></div>); })}</div>
      <h2>Add from this device</h2>
      {suggestions.length > 0 && <><p className="empty">Files that look like {KIND_LABEL[kind].toLowerCase()} (from their names and folders):</p><div className="list">{suggestions.slice(0, 15).map(({ t, c }) => <div className="row static" key={t.id}><Art src={t.art} title={t.title} cls="row-art" /><div className="meta"><b>{t.title}</b><span>{t.album ?? ''} · suggested: {catOf(c).label}</span></div><button className="chip mini-chip" onClick={() => add(t, c)}>Add</button></div>)}</div></>}
      <div className="searchbox"><input placeholder="Search your songs to add…" value={q} onChange={e => setQ(e.target.value)} /></div>
      <div className="chips scrollx">{cats.map(c => <button key={c.id} className={`chip ${assign === c.id ? 'sel' : ''}`} onClick={() => setAssign(c.id)}>{c.label}</button>)}</div>
      <div className="list">{results.map(t => <div className="row static" key={t.id}><Art src={t.art} title={t.title} cls="row-art" /><div className="meta"><b>{t.title}</b><span>{t.artist} · {t.album ?? ''}</span></div><button className="chip mini-chip" onClick={() => add(t, assign)}>Add as {catOf(assign).label}</button></div>)}</div>
      {!local.length && <p className="errmsg">No audio found on this device yet — scan it from Library, then come back.</p>}
    </div>
  );
}
