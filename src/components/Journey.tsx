import { useEffect, useMemo, useState } from 'react';
import { useCollectorData } from '../lib/collector/service';
import { buildChecklist, buildInventory, fmtBytes, fmtDur, readiness, selectForJourney, type Level } from '../lib/journey/inventory';
import { cacheLyricsFor } from '../lib/journey/prepare';
import { defaultPlan, EXPERIENCES, HOURS, JOURNEY_TYPES, type Experience, type JourneyPlan } from '../lib/journey/types';
import { lyricsCache } from '../lib/lyricsCache';
import { newPlaylist, playList, set, useStore } from '../lib/store';
import Icon from './Icon';

const STORAGE_STEPS = [512, 1024, 2048, 4096, 8192, 16384, 32768];
const LEVEL_ICON: Record<Level, string> = { ok: '✓', warn: '!', fail: '✕', todo: '…', info: 'i' };
const THEME: Record<string, string> = { flight: 'sky', train: 'dusk', road: 'sunset', relax: 'calm' };

export default function Journey() {
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
  const update = (patch: Partial<JourneyPlan>) => set({ journey: { ...p, ...patch, created_at: plan?.created_at ?? Date.now() }, journeyVerified: null });
  const meta = JOURNEY_TYPES.find(t => t.id === p.type)!;

  if (!plan) return <Intro onStart={() => set({ journey: defaultPlan() })} />;
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

      <h2>Preparation checklist</h2>
      <div className="checklist">{checks.map(c => (
        <div key={c.id} className={`check lv-${c.level}`}><span className="lv" aria-label={c.level}>{LEVEL_ICON[c.level]}</span>
          <div className="meta"><b>{c.label}{c.mandatory && <small className="req">required</small>}</b><span className="wrap">{c.detail}</span></div></div>))}</div>

      <h2>Your journey</h2>
      <div className="exp-grid">{EXPERIENCES.map(e => <ExperienceTile key={e.id} id={e.id} label={e.label} blurb={e.blurb} milestone={e.milestone} enabled={p.prefs[e.id]}
        count={e.id === 'music' ? sel.tracks.length : e.id === 'stories' ? inv.library.stories : e.id === 'podcasts' ? inv.library.podcasts : e.id === 'sleep' ? inv.library.sleep : undefined}
        onPlay={() => sel.tracks.length && playList(sel.tracks, 0)} />)}</div>

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
  const label = `Journey · ${JOURNEY_TYPES.find(t => t.id === p.type)!.label} ${p.hours}h`;
  return (
    <div className="scan">
      <button className="big" disabled={!sel.tracks.length} onClick={() => playList(sel.tracks, 0)}><Icon n="play" size={18} /> Play journey mix</button>
      <button className="chip" disabled={!sel.tracks.length} onClick={() => { newPlaylist(label, sel.tracks); setMsg(`Playlist “${label}” saved in your Library`); }}>Save as playlist</button>
      <button className="chip" disabled={busy || !sel.tracks.length} onClick={lyrics}>Cache lyrics</button>
      {msg && <span className="scan-msg">{msg}</span>}
    </div>
  );
}

function ExperienceTile({ id, label, blurb, milestone, enabled, count, onPlay }: { id: Experience; label: string; blurb: string; milestone: number; enabled: boolean; count?: number; onPlay: () => void }) {
  const built = id === 'music';
  const status = !enabled ? 'Off in your plan' : built ? (count ? `${count} songs ready` : 'Needs music on device') : count === 0 ? `Needs content · arrives in step ${milestone}` : `Arrives in step ${milestone}`;
  return (
    <button className={`exp ${built && enabled ? 'live' : ''}`} disabled={!built || !enabled || !count} onClick={onPlay} aria-label={`${label}: ${status}`}>
      <span className={`exp-art art-${id}`} /><b>{label}</b><span className="exp-blurb">{blurb}</span><small className={built && count ? 'on' : ''}>{status}</small>
    </button>
  );
}
