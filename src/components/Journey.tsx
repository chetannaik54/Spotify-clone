import { useEffect, useMemo, useState } from 'react';
import { useCollectorData } from '../lib/collector/service';
import { buildChecklist, buildInventory, fmtBytes, fmtDur, readiness, selectForJourney, selectionSig, type Level } from '../lib/journey/inventory';
import { cacheArtFor, cacheLyricsFor } from '../lib/journey/prepare';
import { verifyJourney, type VerifyReport } from '../lib/journey/verify';
import { getFile } from '../lib/db';
import { MediaScan, isNative } from '../lib/scan';
import { deviceFreeBytes } from '../lib/collector/service';
import { defaultPlan, EXPERIENCES, HOURS, JOURNEY_TYPES, type Experience, type JourneyPlan } from '../lib/journey/types';
import { lyricsCache, lyricsKey } from '../lib/lyricsCache';
import { newPlaylist, playList, set, useStore } from '../lib/store';
import Icon from './Icon';
import JourneyQuiz from './JourneyQuiz';
import JourneyMood from './JourneyMood';
import JourneyAudio from './JourneyAudio';
import JourneyMemories from './JourneyMemories';
import { go } from '../lib/nav';
import { byKind, resolveItems } from '../lib/journey/library';
import type { QuizMode } from '../lib/journey/quiz';

const STORAGE_STEPS = [512, 1024, 2048, 4096, 8192, 16384, 32768];
const LEVEL_ICON: Record<Level, string> = { ok: '✓', warn: '!', fail: '✕', todo: '…', info: 'i' };
const THEME: Record<string, string> = { flight: 'sky', train: 'dusk', road: 'sunset', relax: 'calm' };

type View = 'dash' | 'quiz' | 'mood' | 'story' | 'podcast' | 'sleep' | 'memories';
export default function Journey() {
  const [view, setView] = useState<View>('dash'); const [quizMode, setQuizMode] = useState<QuizMode>('song');
  const audioLib = useStore(s => s.audioLib); const memories = useStore(s => s.memories);
  const plan = useStore(s => s.journey); const local = useStore(s => s.local); const verified = useStore(s => s.journeyVerified);
  const data = useCollectorData();
  const [lyricKeys, setLyricKeys] = useState<Set<string>>(new Set());
  const reloadLyrics = () => lyricsCache.cachedKeys().then(setLyricKeys).catch(() => {});
  useEffect(() => { reloadLyrics(); }, []);

  const p = plan ?? defaultPlan();
  const inv = useMemo(() => buildInventory({ local, importedStatuses: data.tracks.map(t => t.matching_status), lyricKeys }), [local, data.tracks, lyricKeys]);
  const sel = useMemo(() => selectForJourney(local, p), [local, p]);
  const checks = useMemo(() => buildChecklist(p, inv, sel, verified, lyricKeys), [p, inv, sel, verified, lyricKeys]);
  const ready = readiness(checks);
  const [vbusy, setVbusy] = useState(''); 
  const runVerify = async () => {
    setVbusy('Checking files…');
    try {
      const report = await verifyJourney(sel.tracks, p, { nativeVerify: isNative ? async uris => (await MediaScan.verify({ uris })).results : undefined, webFile: getFile, freeBytes: deviceFreeBytes, lyricKeys, onProgress: (d, t) => setVbusy(`Checking files… ${d}/${t}`) });
      set({ journeyVerified: { passed: report.passed, at: report.at, sig: report.sig, report } });
    } catch (e) { setVbusy(`Verification failed: ${(e as Error).message}`); return; }
    setVbusy('');
  };
  const update = (patch: Partial<JourneyPlan>) => set({ journey: { ...p, ...patch, created_at: plan?.created_at ?? Date.now() }, journeyVerified: null });
  const meta = JOURNEY_TYPES.find(t => t.id === p.type)!;

  if (!plan) return <Intro onStart={() => set({ journey: defaultPlan() })} />;
  const back = () => setView('dash');
  if (view === 'quiz') return <JourneyQuiz onBack={back} initialMode={quizMode} />;
  if (view === 'mood') return <JourneyMood onBack={back} />;
  if (view === 'story' || view === 'podcast' || view === 'sleep') return <JourneyAudio kind={view} onBack={back} />;
  if (view === 'memories') return <JourneyMemories onBack={back} />;
  const resolved = resolveItems(audioLib, local); const nAudio = (k: 'story' | 'podcast' | 'sleep') => byKind(resolved, k).filter(r => !r.missing).length;
  return (
    <div className="view journey">
      <section className={`jhero theme-${THEME[p.type]}`}>
        <div className="jsky" aria-hidden><i className="star s1" /><i className="star s2" /><i className="star s3" /><span className="jplane">{meta.icon}</span><div className="jhorizon" /></div>
        <div className="jhero-in"><small>JOURNEY MODE</small><h1>{meta.label}<em> · {p.hours} hours</em></h1><p>{meta.blurb}. Everything below is prepared to work with no connection.</p></div>
      </section>

      <div className="jgrid">
        <section className="panel jready">
          <Ring percent={ready.percent} ok={ready.status === 'READY'} />
          <div className="jstatus">
            <span className={`status-chip ${ready.status === 'READY' ? 'ready' : 'notready'}`}>{ready.status === 'READY' ? 'READY' : 'NOT READY'}</span>
            <h2>{ready.status === 'READY' ? 'You are set for take-off' : 'Not ready to go offline yet'}</h2>
            {ready.blockers.length > 0 && <ul className="blockers">{ready.blockers.map(b => <li key={b}>{b}</li>)}</ul>}
            <p className="empty">Swarify only shows READY after every mandatory check, including a playback test, has passed.</p>
          </div>
        </section>

        <section className="panel">
          <h2>Storage</h2>
          <div className="meter"><i style={{ width: `${Math.min(100, (sel.bytes / (p.storageMB * 1024 * 1024)) * 100)}%` }} /></div>
          <p className="empty"><b>{fmtBytes(sel.bytes)}</b> of {fmtBytes(p.storageMB * 1024 * 1024)} · {sel.tracks.length} songs · {fmtDur(sel.seconds)} of {fmtDur(p.hours * 3600)} needed{sel.estimatedBytes ? ` · ${fmtBytes(sel.estimatedBytes)} estimated` : ''}</p>
          <p className="empty">Whole library on this device: {inv.music.count} songs · {fmtDur(inv.music.seconds)} · {fmtBytes(inv.music.bytes)}</p>
          <PrepareActions sel={sel} p={p} reload={reloadLyrics} />
        </section>
      </div>

      <h2>Offline verification</h2>
      <VerifyPanel report={verified?.report} stale={!!verified && verified.sig !== selectionSig(sel.tracks)} busy={vbusy} disabled={!sel.tracks.length || !!vbusy} onRun={runVerify} />

      <h2>Preparation checklist</h2>
      <div className="checklist">{checks.map(c => (
        <div key={c.id} className={`check lv-${c.level}`}><span className="lv" aria-label={c.level}>{LEVEL_ICON[c.level]}</span>
          <div className="meta"><b>{c.label}{c.mandatory && <small className="req">required</small>}</b><span className="wrap">{c.detail}</span></div></div>))}</div>

      <h2>Your journey</h2>
      <div className="exp-grid">{EXPERIENCES.map(e => {
        const n = e.id === 'music' ? sel.tracks.length : e.id === 'stories' ? nAudio('story') : e.id === 'podcasts' ? nAudio('podcast') : e.id === 'sleep' ? nAudio('sleep') : e.id === 'memories' ? memories.length : inv.music.count;
        const act: Record<string, () => void> = { music: () => sel.tracks.length && playList(sel.tracks, 0), mood: () => setView('mood'), stories: () => setView('story'), podcasts: () => setView('podcast'), sleep: () => setView('sleep'), memories: () => setView('memories'),
          guess: () => { setQuizMode('song'); setView('quiz'); }, trivia: () => { setQuizMode('trivia'); setView('quiz'); },
          sing: () => { if (!sel.tracks.length) return; const withLyrics = sel.tracks.filter(t => lyricKeys.has(lyricsKey(t))); const list = withLyrics.length ? withLyrics : sel.tracks; playList(list, 0); go({ full: true, npPanel: 'lyrics' }); } };
        const needs = e.id === 'music' || e.id === 'mood' || e.id === 'guess' || e.id === 'trivia' || e.id === 'sing' ? (n ? '' : 'Needs music on device') : '';
        const status = !p.prefs[e.id] ? 'Off in your plan' : needs || (e.id === 'music' ? `${n} songs ready` : e.id === 'mood' ? `${n} songs to choose from` : e.id === 'guess' || e.id === 'trivia' ? 'From your own songs' : e.id === 'sing' ? `${sel.tracks.filter(t => lyricKeys.has(lyricsKey(t))).length} songs with stored lyrics` : e.id === 'memories' ? `${n} memories` : n ? `${n} saved on device` : 'Add files from your device');
        const on = p.prefs[e.id] && !needs;
        return <button key={e.id} className={`exp ${on ? 'live' : ''}`} disabled={!on && !(['stories', 'podcasts', 'sleep', 'memories'].includes(e.id) && p.prefs[e.id])} onClick={act[e.id]} aria-label={`${e.label}: ${status}`}>
          <span className={`exp-art art-${e.id}`} /><b>{e.label}</b><span className="exp-blurb">{e.blurb}</span><small className={on && n ? 'on' : ''}>{status}</small></button>; })}</div>

      <h2>Plan</h2>
      <section className="panel plan">
        <h3>Journey type</h3>
        <div className="type-grid">{JOURNEY_TYPES.map(t => <button key={t.id} className={`type-card ${p.type === t.id ? 'sel' : ''}`} onClick={() => update({ type: t.id })}><span>{t.icon}</span><b>{t.label}</b></button>)}</div>
        <h3>Expected duration</h3>
        <div className="chips">{HOURS.map(h => <button key={h} className={`chip ${p.hours === h ? 'sel' : ''}`} onClick={() => update({ hours: h })}>{h} hours</button>)}</div>
        <h3>Storage limit</h3>
        <div className="chips">{STORAGE_STEPS.map(m => <button key={m} className={`chip ${p.storageMB === m ? 'sel' : ''}`} onClick={() => update({ storageMB: m })}>{fmtBytes(m * 1024 * 1024)}</button>)}</div>
        <h3>Preferred genres</h3>
        {inv.music.genres.length ? <div className="chips">{inv.music.genres.slice(0, 14).map(g => (
          <button key={g.name} className={`chip ${p.genres.includes(g.name) ? 'sel' : ''}`} onClick={() => update({ genres: p.genres.includes(g.name) ? p.genres.filter(x => x !== g.name) : [...p.genres, g.name] })}>{g.name} <small>{g.count}</small></button>))}</div>
          : <p className="empty">None of your songs carry genre tags, so genre filtering is unavailable. (Tags are read when you scan the device.)</p>}
        <h3>Entertainment</h3>
        <div className="chips">{EXPERIENCES.map(e => <button key={e.id} className={`chip ${p.prefs[e.id] ? 'sel' : ''}`} onClick={() => update({ prefs: { ...p.prefs, [e.id]: !p.prefs[e.id] } })}>{e.label}</button>)}</div>
        <div className="acc-actions"><button className="chip danger" onClick={() => set({ journey: null, journeyVerified: null })}>Discard plan</button></div>
      </section>
    </div>
  );
}

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <div className="view journey">
      <section className="jhero theme-sky intro"><div className="jsky" aria-hidden><i className="star s1" /><i className="star s2" /><i className="star s3" /><span className="jplane">✈️</span><div className="jhorizon" /></div>
        <div className="jhero-in"><small>NEW</small><h1>Journey Mode</h1><p>Heading somewhere with no signal? Swarify prepares music, lyrics and entertainment from your own library so everything works offline — and tells you honestly whether you are ready.</p>
          <button className="big" onClick={onStart}><Icon n="journey" size={18} /> Plan a journey</button></div></section>
    </div>
  );
}

function Ring({ percent, ok }: { percent: number; ok: boolean }) {
  const r = 44, c = 2 * Math.PI * r;
  return <div className="ring" role="img" aria-label={`${percent}% prepared`}><svg viewBox="0 0 110 110"><circle cx="55" cy="55" r={r} className="ring-bg" /><circle cx="55" cy="55" r={r} className={`ring-fg ${ok ? 'ok' : ''}`} style={{ strokeDasharray: c, strokeDashoffset: c * (1 - percent / 100) }} /></svg><b>{percent}%</b></div>;
}

function PrepareActions({ sel, p, reload }: { sel: ReturnType<typeof selectForJourney>; p: JourneyPlan; reload: () => void }) {
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const lyrics = async () => {
    if (!navigator.onLine) { setMsg('You are offline — connect to Wi-Fi once to store lyrics for this journey.'); return; }
    setBusy(true); setMsg('Caching lyrics…');
    try { const r = await cacheLyricsFor(sel.tracks, (d, t) => setMsg(`Caching lyrics… ${d}/${t}`)); setMsg(`Lyrics stored for ${r.cached + r.skipped} songs · ${r.none} have none · ${r.failed} failed`); reload(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const art = async () => {
    if (!navigator.onLine) { setMsg('You are offline — connect to Wi-Fi once to store artwork for this journey.'); return; }
    setBusy(true); setMsg('Caching artwork…');
    try { const r = await cacheArtFor(sel.tracks, (d, t) => setMsg(`Caching artwork… ${d}/${t}`)); setMsg(`Artwork stored for ${r.cached} songs${r.failed ? ` · ${r.failed} failed` : ''} · ${r.skipped} already on device`); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const label = `Journey · ${JOURNEY_TYPES.find(t => t.id === p.type)!.label} ${p.hours}h`;
  return (
    <div className="scan">
      <button className="big" disabled={!sel.tracks.length} onClick={() => playList(sel.tracks, 0)}><Icon n="play" size={18} /> Play journey mix</button>
      <button className="chip" disabled={!sel.tracks.length} onClick={() => { newPlaylist(label, sel.tracks); setMsg(`Playlist “${label}” saved in your Library`); }}>Save as playlist</button>
      <button className="chip" disabled={busy || !sel.tracks.length} onClick={lyrics}>Cache lyrics</button>
      <button className="chip" disabled={busy || !sel.tracks.length} onClick={art}>Cache artwork</button>
      {msg && <span className="scan-msg">{msg}</span>}
    </div>
  );
}


function VerifyPanel({ report, stale, busy, disabled, onRun }: { report?: VerifyReport; stale: boolean; busy: string; disabled: boolean; onRun: () => void }) {
  const bad = report ? [...report.missing, ...report.corrupt, ...report.unverifiable, ...report.network] : [];
  return (
    <section className="panel verify">
      <div className="acc-actions"><button className="big" disabled={disabled} onClick={onRun}>{report ? 'Run verification again' : 'Run offline verification'}</button>{busy && <span className="busy"><span className="spin" />{busy}</span>}</div>
      <p className="empty">Checks every song in the mix: the file exists, can be read, starts like real audio and can be decoded by Android; its length matches; lyrics are stored (if sing-along is on); nothing needs the internet; and free space is not nearly zero.</p>
      {report && <>
        <div className={`vres ${report.passed && !stale ? 'pass' : 'fail'}`}><b>{stale ? 'OUT OF DATE' : report.passed ? 'PASSED' : 'NOT PASSED'}</b>
          <span>{report.ok}/{report.total} files OK · lyrics {report.lyricsCached}/{report.total}{report.lyricsNeeded ? '' : ' (optional)'}{report.freeBytes != null ? ` · ${fmtBytes(report.freeBytes)} free` : ''} · checked {new Date(report.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
        {stale && <p className="errmsg">Your mix or files changed after this check. Run it again before you travel.</p>}
        {report.reasons.length > 0 && <ul className="blockers">{report.reasons.map(r => <li key={r}>{r}</li>)}</ul>}
        {bad.length > 0 && <details className="help" open><summary>{bad.length} file problem(s)</summary><div className="list">{bad.slice(0, 30).map(c => <div className="row static" key={c.id}><div className="meta"><b>{c.title}</b><span className="err">{c.status.toUpperCase()} — {c.detail}</span></div></div>)}</div></details>}
      </>}
    </section>
  );
}
