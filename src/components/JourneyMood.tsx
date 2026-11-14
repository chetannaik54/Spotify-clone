import { useMemo, useState } from 'react';
import { MOODS, buildMoodMix, moodScore, type Mood } from '../lib/journey/mood';
import { newPlaylist, playList, set, useStore } from '../lib/store';
import { Art, fmt } from './Bits';

export default function JourneyMood({ onBack }: { onBack: () => void }) {
  const local = useStore(s => s.local); const liked = useStore(s => s.liked); const recent = useStore(s => s.recent); const fb = useStore(s => s.moodFeedback); const cf = useStore(s => s.crossfade);
  const [mood, setMood] = useState<Mood>('relaxing'); const [min, setMin] = useState(30); const [strict, setStrict] = useState(false); const [seed, setSeed] = useState(1);
  const mix = useMemo(() => buildMoodMix(local, mood, min, { feedback: fb, likedIds: new Set(liked.map(t => t.id)), recentIds: new Set(recent.slice(0, 20).map(t => t.id)), allowFiller: !strict }), [local, mood, min, strict, fb, liked, recent, seed]); // eslint-disable-line
  const why = (id: string) => { const t = mix.tracks.find(x => x.id === id)!; return moodScore(t, mood, fb[id], false).why.join(' · ') || 'filler — no mood evidence'; };
  const vote = (id: string, v: 1 | -1) => { set(s => ({ moodFeedback: { ...s.moodFeedback, [id]: { ...(s.moodFeedback[id] ?? {}), [mood]: s.moodFeedback[id]?.[mood] === v ? 0 : v } as Record<string, 1 | -1> } })); };
  const label = MOODS.find(m => m.id === mood)!;
  return (
    <div className="view">
      <button className="back" onClick={onBack}>← Journey</button><h1>Mood DJ</h1>
      <p className="empty">Playlists from your own library, picked from titles, genres, years and your feedback — not audio analysis. Tap ✓ or ✕ to teach it what fits.</p>
      <div className="chips">{MOODS.map(m => <button key={m.id} className={`chip ${mood === m.id ? 'sel' : ''}`} onClick={() => setMood(m.id)}>{m.emoji} {m.label}</button>)}</div>
      <h3 className="h3">Length</h3><div className="chips">{[15, 30, 60, 120].map(n => <button key={n} className={`chip ${min === n ? 'sel' : ''}`} onClick={() => setMin(n)}>{n < 60 ? `${n} min` : `${n / 60} h`}</button>)}
        <button className={`chip ${strict ? 'sel' : ''}`} onClick={() => setStrict(!strict)}>Only songs that fit</button>
        <button className={`chip ${cf ? 'sel' : ''}`} onClick={() => set({ crossfade: cf ? 0 : 4 })}>Crossfade {cf ? `${cf}s` : 'off'}</button></div>
      <div className="acc-actions"><button className="big" disabled={!mix.tracks.length} onClick={() => playList(mix.tracks, 0)}>▶ Play {label.label} mix</button>
        <button className="chip" disabled={!mix.tracks.length} onClick={() => newPlaylist(`Mood · ${label.label} ${min < 60 ? min + 'm' : min / 60 + 'h'}`, mix.tracks)}>Save as playlist</button><button className="chip" onClick={() => setSeed(seed + 1)}>Shuffle picks</button></div>
      <p className="empty">{mix.tracks.length} songs · {Math.round(mix.seconds / 60)} min · {mix.matched} match the mood{mix.filler ? ` · ${mix.filler} filler` : ''}</p>
      {!local.length && <p className="errmsg">No songs on this device yet — scan your music in Library.</p>}
      <div className="list">{mix.tracks.slice(0, 40).map(t => (
        <div className="row static" key={t.id}><Art src={t.art} title={t.title} cls="row-art" /><div className="meta"><b>{t.title}</b><span>{t.artist} · {why(t.id)}</span></div><span className="dur">{t.duration ? fmt(t.duration) : ''}</span>
          <button className={`ic ${fb[t.id]?.[mood] === 1 ? 'sel' : ''}`} aria-label="Fits this mood" onClick={() => vote(t.id, 1)}>✓</button><button className={`ic ${fb[t.id]?.[mood] === -1 ? 'liked' : ''}`} aria-label="Does not fit" onClick={() => vote(t.id, -1)}>✕</button></div>))}</div>
    </div>
  );
}
