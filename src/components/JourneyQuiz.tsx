import { useEffect, useMemo, useRef, useState } from 'react';
import { DIFF, MODES, addToBoard, makeQuestions, scoreAnswer, type Difficulty, type Question, type QuizMode } from '../lib/journey/quiz';
import { lyricsCache } from '../lib/lyricsCache';
import { parseLrc } from '../lib/lrc';
import { getState, playList, set, useStore } from '../lib/store';
import type { Track } from '../lib/types';

/** Offline quiz from the user's own library. Clips play through the normal player; the previous queue is restored on exit. */
export default function JourneyQuiz({ onBack, initialMode }: { onBack: () => void; initialMode?: QuizMode }) {
  const local = useStore(s => s.local); const board = useStore(s => s.quizBoard);
  const [mode, setMode] = useState<QuizMode>(initialMode ?? 'song'); const [diff, setDiff] = useState<Difficulty>('medium'); const [count, setCount] = useState(10);
  const [qs, setQs] = useState<Question[] | null>(null); const [problem, setProblem] = useState(''); const [busy, setBusy] = useState(false);
  const prev = useRef<{ queue: Track[]; index: number } | null>(null);
  const tracks = useMemo(() => local.filter(t => t.source === 'local' && t.url), [local]);

  const start = async () => {
    setBusy(true); setProblem('');
    let lyrics: Map<string, string[]> | undefined;
    if (mode === 'lyrics') { lyrics = new Map(); for (const t of tracks.slice(0, 80)) { const c = await lyricsCache.get(t).catch(() => ({ hit: false, text: null as string | null })); if (c.text) { const parsed = parseLrc(c.text); lyrics.set(t.id, (parsed ? parsed.map(l => l.text) : c.text.split('\n')).map(x => x.trim()).filter(Boolean)); } } }
    const r = makeQuestions({ tracks, lyrics }, mode, diff, count);
    setBusy(false); if (!r.questions.length) { setProblem(r.problem ?? 'Could not build questions'); return; }
    const s = getState(); prev.current = { queue: s.queue, index: s.index }; setQs(r.questions);
  };
  const finish = () => { setQs(null); const p = prev.current; if (p?.queue.length) set({ queue: p.queue, index: p.index, playing: false }); else set({ playing: false }); prev.current = null; };
  useEffect(() => () => { if (prev.current?.queue.length) set({ queue: prev.current.queue, index: prev.current.index, playing: false }); }, []);

  if (qs) return <Game qs={qs} diff={diff} mode={mode} tracks={tracks} onExit={finish} />;
  return (
    <div className="view">
      <button className="back" onClick={onBack}>← Journey</button><h1>Guess the Song &amp; Trivia</h1>
      <p className="empty">Everything comes from the songs stored on this device — no internet, no previews. Audio clips play through the normal player.</p>
      <div className="mode-grid">{MODES.map(m => <button key={m.id} className={`mode-card ${mode === m.id ? 'sel' : ''}`} onClick={() => setMode(m.id)}><b>{m.label}</b><span>{m.blurb}</span></button>)}</div>
      <h3 className="h3">Difficulty</h3><div className="chips">{(['easy', 'medium', 'hard'] as Difficulty[]).map(d => <button key={d} className={`chip ${diff === d ? 'sel' : ''}`} onClick={() => setDiff(d)}>{d[0].toUpperCase() + d.slice(1)} <small>{DIFF[d].options} choices · {DIFF[d].clip}s clip · {DIFF[d].time}s</small></button>)}</div>
      <h3 className="h3">Questions</h3><div className="chips">{[5, 10, 15].map(n => <button key={n} className={`chip ${count === n ? 'sel' : ''}`} onClick={() => setCount(n)}>{n}</button>)}</div>
      <div className="acc-actions"><button className="big" disabled={busy || tracks.length < 4} onClick={start}>{busy ? 'Preparing…' : 'Start'}</button></div>
      {tracks.length < 4 && <p className="errmsg">You need at least 4 songs on this device. Scan your music in Library.</p>}
      {problem && <p className="errmsg">{problem}</p>}
      <h2>Local leaderboard</h2>
      {!board.length ? <p className="empty">No scores yet. Play a round!</p> : <div className="list">{board.map((b, i) => <div className="row static" key={b.at}><span className="idx">{i + 1}</span><div className="meta"><b>{b.score} pts</b><span>{MODES.find(m => m.id === b.mode)?.label} · {b.diff} · {b.correct}/{b.total} correct · best streak {b.bestStreak} · {new Date(b.at).toLocaleDateString()}</span></div></div>)}</div>}
      {board.length > 0 && <button className="chip danger" onClick={() => set({ quizBoard: [] })}>Clear leaderboard</button>}
    </div>
  );
}

function Game({ qs, diff, mode, tracks, onExit }: { qs: Question[]; diff: Difficulty; mode: QuizMode; tracks: Track[]; onExit: () => void }) {
  const [i, setI] = useState(0); const [picked, setPicked] = useState<number | null>(null); const [left, setLeft] = useState(qs[0].timeSec);
  const [score, setScore] = useState(0); const [streak, setStreak] = useState(0); const [best, setBest] = useState(0); const [correct, setCorrect] = useState(0); const [gain, setGain] = useState(0); const [done, setDone] = useState(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null); const q = qs[i]; const saved = useRef(false);

  const playClip = () => {
    if (!q.audio || !q.trackId) return; const t = tracks.find(x => x.id === q.trackId); if (!t) return;
    if (stopTimer.current) clearTimeout(stopTimer.current);
    set({ startAt: { id: t.id, pos: q.clipStart } }); playList([t], 0);
    stopTimer.current = setTimeout(() => set({ playing: false }), q.clipSec * 1000);
  };
  useEffect(() => { setPicked(null); setLeft(q.timeSec); setGain(0); playClip(); return () => { if (stopTimer.current) clearTimeout(stopTimer.current); }; }, [i]); // eslint-disable-line
  useEffect(() => {
    if (picked !== null || done) return; const t = setInterval(() => setLeft(l => { const n = +(l - 0.1).toFixed(1); if (n <= 0) { clearInterval(t); answer(-1, 0); return 0; } return n; }), 100); return () => clearInterval(t);
  }, [i, picked, done]); // eslint-disable-line
  useEffect(() => () => { set({ playing: false }); }, []);

  const answer = (idx: number, timeLeft = left) => {
    if (picked !== null) return; setPicked(idx); set({ playing: false }); if (stopTimer.current) clearTimeout(stopTimer.current);
    const ok = idx === q.answer; const pts = scoreAnswer(ok, timeLeft, diff, streak, q.timeSec); setGain(pts); setScore(s => s + pts);
    if (ok) { setCorrect(c => c + 1); setStreak(s => { const n = s + 1; setBest(b => Math.max(b, n)); return n; }); } else setStreak(0);
  };
  const next = () => { if (i + 1 >= qs.length) setDone(true); else setI(i + 1); };
  useEffect(() => { if (done && !saved.current) { saved.current = true; set(s => ({ quizBoard: addToBoard(s.quizBoard, { score, mode, diff, correct, total: qs.length, bestStreak: best, at: Date.now() }) })); } }, [done]); // eslint-disable-line

  if (done) return (
    <div className="view quiz-end"><h1>Round complete</h1><div className="score-big">{score}<small> pts</small></div>
      <p className="empty">{correct} of {qs.length} correct · best streak {best} · saved to your local leaderboard</p>
      <div className="acc-actions"><button className="big" onClick={onExit}>Done</button></div></div>);
  return (
    <div className="view quiz">
      <div className="quiz-top"><button className="back" onClick={onExit}>✕ Quit</button><span>Question {i + 1}/{qs.length}</span><span className="streak">🔥 {streak}</span><b>{score} pts</b></div>
      <div className="timer"><i style={{ width: `${(left / q.timeSec) * 100}%` }} className={left < 5 ? 'low' : ''} /></div>
      <h2 className="q-prompt">{q.prompt}</h2>
      {q.audio && <div className="acc-actions"><button className="chip" onClick={playClip}>🎧 Replay clip ({q.clipSec}s)</button></div>}
      <div className="opts">{q.options.map((o, k) => <button key={o + k} disabled={picked !== null} className={`opt ${picked !== null ? (k === q.answer ? 'right' : k === picked ? 'wrong' : '') : ''}`} onClick={() => answer(k)}>{o}</button>)}</div>
      {picked !== null && <div className="reveal"><b>{picked === q.answer ? `Correct! +${gain}` : picked === -1 ? 'Time’s up' : 'Not quite'}</b><span>{q.reveal}</span><button className="big" onClick={next}>{i + 1 >= qs.length ? 'See score' : 'Next'}</button></div>}
    </div>
  );
}
