import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { confirmMatch, confirmSelectedMatches, catalogue, giveMatchConsent, hasMatchConsent, rejectMatch, retryFailedMatches, runMatching, skipTrack, skipUnavailable, stopMatching, useCollectorUi } from '../lib/collector/service';
import type { MatchRecord, ScoredCandidate } from '../lib/collector/match/types';
import type { ImportedPlaylist, ImportedTrack } from '../lib/collector/types';
import { displayName } from '../lib/collector/playlistNames';
import { buildReport, eligible as eligibleCand, orderedTracks, summarise } from '../lib/collector/match/report';
import { set, useStore } from '../lib/store';
import { Art, fmt } from './Bits';

const PLAT: Record<string, string> = { spotify: 'Spotify', youtube: 'YouTube', csv: 'CSV' };
const SRC: Record<string, string> = { local: 'This device', jamendo: 'Jamendo', archive: 'Internet Archive', soundcloud: 'SoundCloud' };
type Filter = 'all' | 'exact' | 'possible' | 'free' | 'downloaded' | 'none' | 'review';
const FILTERS: [Filter, string][] = [['all', 'All tracks'], ['exact', 'Exact matches'], ['possible', 'Possible matches'], ['free', 'Free downloads available'], ['downloaded', 'Already downloaded'], ['none', 'Unavailable'], ['review', 'Manual review']];

const eligible = eligibleCand;
function passes(f: Filter, t: ImportedTrack, r?: MatchRecord) {
  const best = r?.candidates[0]; const sel = r?.candidates.find(c => c.key === r.selected);
  switch (f) {
    case 'all': return true;
    case 'exact': return best?.band === 'exact';
    case 'possible': return t.matching_status === 'possible_match' && best?.band === 'likely';
    case 'free': return sel ? sel.download.permitted && !sel.download.local : !!r?.candidates.some(eligible);
    case 'downloaded': return t.matching_status === 'downloaded';
    case 'none': return t.matching_status === 'no_match' || t.matching_status === 'failed' || t.matching_status === 'unavailable';   // same set as the Unavailable tile
    case 'review': return t.matching_status === 'possible_match' && !sel && best?.band === 'review';
  }
}

export default function Matching({ tracks, matches, playlists }: { tracks: ImportedTrack[]; matches: MatchRecord[]; playlists: ImportedPlaylist[] }) {
  const ui = useCollectorUi(); const jamendoId = useStore(s => s.jamendoId); const scId = useStore(s => s.soundcloudId); const srcOn = useStore(s => s.matchSources);
  const [filter, setFilter] = useState<Filter>('all'); const [sel, setSel] = useState<Set<string>>(new Set()); const [open, setOpen] = useState<string | null>(null); const [limit, setLimit] = useState(60); const [consent, setConsent] = useState(false);
  const [plId, setPlId] = useState<string>(''); const [copied, setCopied] = useState('');
  const ordered = useMemo(() => orderedTracks(playlists, tracks, plId || undefined).filter(o => o.track.import_status === 'imported'), [playlists, tracks, plId]);   // original playlist order
  const songs = useMemo(() => ordered.map(o => o.track), [ordered]);
  const posOf = useMemo(() => new Map(ordered.map(o => [o.track.id, o.position])), [ordered]);
  const sum = useMemo(() => summarise(songs, matches), [songs, matches]);
  const rec = useMemo(() => new Map(matches.map(m => [m.track_id, m])), [matches]);
  const shown = useMemo(() => songs.filter(t => passes(filter, t, rec.get(t.id))), [songs, filter, rec]);
  const count = (f: Filter) => songs.filter(t => passes(f, t, rec.get(t.id))).length;
  const m = ui.match; const pct = m.progress && m.progress.total ? Math.round((m.progress.done / m.progress.total) * 100) : 0;
  const start = () => (hasMatchConsent() ? runMatching() : setConsent(true));
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <section className="panel match">
      <div className="sum-grid" aria-label="Matching summary">
        <div className="sum"><b>{sum.exact}</b><span>Exact</span></div><div className="sum"><b>{sum.possible + sum.review}</b><span>Possible</span></div>
        <div className="sum"><b>{sum.unavailable}</b><span>Unavailable</span></div><div className="sum good"><b>{sum.downloadable}</b><span>Downloadable</span></div><div className="sum"><b>{sum.onDevice}</b><span>On device</span></div>
      </div>
      {playlists.filter(p => p.entries.length).length > 1 && <label className="field plsel">Playlist <select value={plId} onChange={e => { setPlId(e.target.value); setLimit(60); }}><option value="">All playlists (original order)</option>{playlists.filter(p => p.entries.length).map(p => <option key={p.id} value={p.id}>{displayName(p)}</option>)}</select></label>}
      <div className="chips">{FILTERS.map(([f, l]) => <button key={f} className={`chip ${filter === f ? 'sel' : ''}`} onClick={() => { setFilter(f); setLimit(60); }}>{l} <small>{count(f)}</small></button>)}</div>

      <details className="help"><summary>Sources &amp; privacy</summary>
        <p className="empty">Searching sends only each song’s <b>title and artist</b> to the catalogues you enable — never your account, playlist names or the audio. Songs already on this device are matched locally with no network.</p>
        <div className="src-grid">
          <label className="src"><input type="checkbox" checked={srcOn.archive} onChange={e => set({ matchSources: { ...srcOn, archive: e.target.checked } })} /> <b>Internet Archive</b><small>No key. Download only with an explicit open license.</small></label>
          <label className="src"><input type="checkbox" checked={srcOn.jamendo} onChange={e => set({ matchSources: { ...srcOn, jamendo: e.target.checked } })} /> <b>Jamendo</b><small>Independent artists. Needs a free client ID.</small>
            <input type="text" placeholder="Jamendo client ID" value={jamendoId} onChange={e => set({ jamendoId: e.target.value.trim() })} onClick={e => e.stopPropagation()} /></label>
          <label className="src"><input type="checkbox" checked={srcOn.soundcloud} onChange={e => set({ matchSources: { ...srcOn, soundcloud: e.target.checked } })} /> <b>SoundCloud</b><small>Only artist-enabled downloads. Needs your own client ID (API access is restricted).</small>
            <input type="text" placeholder="SoundCloud client ID" value={scId} onChange={e => set({ soundcloudId: e.target.value.trim() })} onClick={e => e.stopPropagation()} /></label>
        </div></details>

      <div className="acc-actions">
        {m.running ? <button className="chip danger" onClick={stopMatching}>Stop</button> : <button className="big" disabled={!songs.length} onClick={start}>Find Available Downloads</button>}
        <button className="chip" disabled={m.running || !sel.size} onClick={async () => { await confirmSelectedMatches([...sel]); setSel(new Set()); }}>Confirm selected ({sel.size})</button>
        <button className="chip" disabled={m.running || !count('none')} onClick={retryFailedMatches}>Retry failed</button>
        <button className="chip" disabled={m.running || !count('none')} onClick={skipUnavailable}>Skip unavailable</button>
        <button className="chip" disabled title="Nothing is downloaded until you have reviewed the results. The downloader arrives in the next step.">Download eligible ({sum.downloadable})</button>
        <button className="chip" disabled={!songs.length} onClick={async () => { const txt = buildReport(ordered, matches); try { await navigator.clipboard.writeText(txt); setCopied(`Copied ${ordered.length} rows — paste them anywhere to share the real results`); } catch { setCopied('Copy failed — your browser blocked clipboard access'); } }}>Copy results</button>
      </div>
      {copied && <p className="okmsg">{copied}</p>}
      <p className="empty">Nothing is downloaded automatically. Review the results first — a download is only offered where the source itself permits it.</p>
      {m.running && <div className="meter"><i style={{ width: `${pct}%` }} /></div>}
      {(m.running || m.note) && <p className="busy">{m.running && <span className="spin" />}{m.running ? `Matching “${m.progress?.current ?? ''}” (${m.progress?.done ?? 0}/${m.progress?.total ?? 0})` : m.note}</p>}
      {!songs.length && <p className="empty">Import a playlist first — matching works on the songs in your imported playlists.</p>}

      <div className="list">{shown.slice(0, limit).map(t => <MatchRow key={t.id} t={t} pos={plId ? posOf.get(t.id) : undefined} r={rec.get(t.id)} open={open === t.id} checked={sel.has(t.id)} onCheck={() => toggle(t.id)} onOpen={() => setOpen(open === t.id ? null : t.id)} />)}
        {shown.length > limit && <button className="chip" onClick={() => setLimit(limit + 60)}>Show more ({shown.length - limit})</button>}</div>
      {consent && createPortal(
        <div className="modal-bg" onClick={() => setConsent(false)}><div className="modal" role="dialog" aria-label="Before searching" onClick={e => e.stopPropagation()}>
          <h2>Before searching online</h2>
          <ul className="bullets"><li>For each song Swarify sends only its <b>title and artist</b> to the catalogues you enabled (Internet Archive, Jamendo, SoundCloud).</li>
            <li>Nothing about you, your accounts or your playlists is sent. Audio is never uploaded.</li>
            <li>A download button appears <b>only</b> when the source’s own data says that recording may be downloaded. Covers, remixes and different artists are never chosen automatically.</li>
            <li>Matching your own device’s files needs no network.</li></ul>
          <div className="acc-actions"><button className="chip" onClick={() => { setConsent(false); runMatching(); }}>Only search this device</button><button className="big" onClick={() => { giveMatchConsent(); setConsent(false); runMatching(); }}>Allow online search</button></div>
        </div></div>, document.body)}
    </section>
  );
}

const confClass = (c: number) => (c >= 95 ? 'c-exact' : c >= 80 ? 'c-likely' : 'c-review');
function MatchRow({ t, pos, r, open, checked, onCheck, onOpen }: { t: ImportedTrack; pos?: number; r?: MatchRecord; open: boolean; checked: boolean; onCheck: () => void; onOpen: () => void }) {
  const best = r?.candidates.find(c => c.key === r.selected) ?? r?.candidates[0];
  return (
    <div className={`m-row ${open ? 'open' : ''}`}>
      <div className="row" onClick={onOpen}>
        {pos != null && <span className="idx">{pos}</span>}
        <input type="checkbox" aria-label="Select" checked={checked} onClick={e => e.stopPropagation()} onChange={onCheck} />
        <Art src={t.artwork_url} title={t.song_title} cls="row-art" />
        <div className="meta"><b>{t.song_title}</b><span>{t.artist_name || t.channel || 'Unknown artist'} · {PLAT[t.source_platform]}</span>
          {best ? <span className="m-best">→ {best.title} · {best.artist || 'unknown'} · {SRC[best.source]}</span> : <span className="m-best dim">{t.matching_status === 'failed' ? 'Search failed — retry' : t.matching_status === 'no_match' ? 'No match found' : t.matching_status === 'unavailable' ? 'Skipped' : 'Not matched yet'}</span>}</div>
        {best && <span className={`conf ${confClass(best.confidence)}`} title="Match confidence">{best.confidence}%</span>}
        <StatusPill t={t} r={r} />
      </div>
      {open && <Detail t={t} r={r} />}
    </div>
  );
}

function StatusPill({ t, r }: { t: ImportedTrack; r?: MatchRecord }) {
  const sel = r?.candidates.find(c => c.key === r.selected);
  const txt = t.matching_status === 'downloaded' ? 'On device' : t.matching_status === 'download_permitted' ? 'Download permitted' : t.matching_status === 'matched' ? 'Matched · no download' : t.matching_status === 'possible_match' ? (r?.candidates[0]?.band === 'likely' ? 'Confirm?' : 'Review') : t.matching_status === 'no_match' ? 'No match' : t.matching_status === 'failed' ? 'Failed' : t.matching_status === 'unavailable' ? 'Skipped' : 'Not matched';
  return <span className={`pill-s s-${t.matching_status}`}>{sel?.download.local ? 'On device' : txt}</span>;
}

function Detail({ t, r }: { t: ImportedTrack; r?: MatchRecord }) {
  if (!r) return <p className="empty">Not searched yet. Use “Find all matches”.</p>;
  return (
    <div className="detail">
      {r.errors.length > 0 && <p className="errmsg">{r.errors.map(e => `${SRC[e.source]}: ${e.message}`).join(' · ')}</p>}
      {!r.candidates.length && <p className="empty">No recording was found{r.errors.length ? ' (some sources failed)' : ''}.</p>}
      {r.candidates.map(c => <CandidateCard key={c.key} t={t} c={c} selected={r.selected === c.key} />)}
      <div className="acc-actions">{r.selected && <button className="chip" onClick={() => rejectMatch(catalogue, t.id)}>Reject this match</button>}
        <button className="chip" onClick={() => skipTrack(catalogue, t.id, !r.skipped)}>{r.skipped ? 'Un-skip' : 'Skip this song'}</button></div>
    </div>
  );
}

function CandidateCard({ t, c, selected }: { t: ImportedTrack; c: ScoredCandidate; selected: boolean }) {
  const diff = c.duration_diff_ms == null ? '—' : `${c.duration_diff_ms >= 0 ? '+' : '−'}${Math.abs(Math.round(c.duration_diff_ms / 1000))} s`;
  return (
    <div className={`cand ${selected ? 'sel' : ''}`}>
      <div className="cmp"><div><small>YOUR SONG</small><b>{t.song_title}</b><span>{t.artist_name || 'Unknown artist'}{t.album_name ? ` · ${t.album_name}` : ''}</span><span>{PLAT[t.source_platform]} · {t.duration_ms ? fmt(t.duration_ms / 1000) : '—'}</span></div>
        <div><small>MATCH · {SRC[c.source].toUpperCase()}</small><b>{c.title}</b><span>{c.artist || 'Unknown artist'}{c.album ? ` · ${c.album}` : ''}</span><span>{c.duration_ms ? fmt(c.duration_ms / 1000) : '—'} ({diff})</span></div></div>
      <div className="facts">
        <span className={`conf ${confClass(c.confidence)}`}>{c.confidence}% · {c.band === 'exact' ? 'exact' : c.band === 'likely' ? 'likely — confirm' : 'manual review'}</span>
        <span className="fact">Quality: {c.quality.label}</span><span className="fact">{c.full_length ? 'Full length' : 'Preview only'}</span>
        <span className={`fact ${c.download.local ? 'good' : c.download.permitted ? (c.flags.some(f => /^Different/.test(f)) ? 'warn' : 'good') : 'bad'}`}>{c.download.local ? 'On your device' : c.download.permitted ? (c.flags.some(f => /^Different/.test(f)) ? '⚠ Downloadable, but a different recording' : '✓ Download permitted') : '✕ Download not permitted'}</span>
      </div>
      <p className="why">{c.download.reason}</p>
      {c.flags.length > 0 && <p className="flags">{c.flags.map(f => <span key={f}>⚠ {f}</span>)}</p>}
      <div className="acc-actions">
        {!selected && <button className="chip" onClick={() => confirmMatch(catalogue, t.id, c.key)}>Confirm this match</button>}
        {selected && <span className="okmsg">Confirmed{c.download.permitted && !c.download.local ? ' — ready for download' : ''}</span>}
        <button className="chip" disabled={!(selected && c.download.permitted && !c.download.local)} title={selected ? 'Downloads arrive in the next milestone' : 'Confirm the match first'}>Download</button>
        {c.page_url && <a className="chip" href={c.page_url} target="_blank" rel="noreferrer">Source page</a>}
      </div>
    </div>
  );
}
