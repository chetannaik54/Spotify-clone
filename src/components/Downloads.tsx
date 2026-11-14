import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { catalogue, downloads, setReview, useCollectorUi, useDownloadJobs } from '../lib/collector/service';
import { orderedTracks } from '../lib/collector/match/report';
import type { DownloadJob } from '../lib/collector/download/types';
import type { ImportedPlaylist, ImportedTrack } from '../lib/collector/types';
import { set, useStore } from '../lib/store';
import { Art, fmt } from './Bits';

const MB = 1024 * 1024;
const mb = (b: number) => (b >= 1024 * MB ? `${(b / 1024 / MB).toFixed(1)} GB` : `${Math.max(0, Math.round(b / MB))} MB`);
const STATE: Record<DownloadJob['state'], string> = { queued: 'Queued', downloading: 'Downloading', paused: 'Paused', waiting_wifi: 'Waiting for Wi-Fi', verifying: 'Verifying', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };

export default function Downloads({ tracks, playlists }: { tracks: ImportedTrack[]; playlists: ImportedPlaylist[] }) {
  const jobs = useDownloadJobs(); const dl = useStore(s => s.dl); const ui = useCollectorUi();
  const used = jobs.filter(j => j.state === 'done').reduce((n, j) => n + (j.result?.size ?? 0), 0);
  const active = jobs.filter(j => ['queued', 'downloading', 'paused', 'waiting_wifi', 'verifying'].includes(j.state)).length;
  const [eligibleCount, setEligibleCount] = useState(0);
  useEffect(() => { let live = true; (async () => { let n = 0; for (const t of tracks) if (t.import_status === 'imported' && (await downloads.eligibility(t)).ok) n++; if (live) setEligibleCount(n); })(); return () => { live = false; }; }, [tracks, jobs.length]);
  return (
    <section className="panel dlm">
      <div className="acc-actions">
        <button className="big" disabled={!eligibleCount} onClick={() => setReview(true)}>Review &amp; download eligible ({eligibleCount})</button>
        <button className="chip" disabled={!active} onClick={() => downloads.pauseAll()}>Pause all</button>
        <button className="chip" disabled={!jobs.some(j => j.state === 'paused' || j.state === 'waiting_wifi')} onClick={() => downloads.resumeAll()}>Resume all</button>
        <button className="chip" disabled={!jobs.some(j => j.state === 'done' || j.state === 'cancelled')} onClick={() => downloads.clearFinished()}>Clear finished</button>
      </div>
      <p className="empty">Nothing downloads until you review the list and confirm. Only recordings whose source explicitly allows downloading are offered. Files are saved to <b>Music/Swarify/Artist/Album/</b> on the device and added to your library.</p>
      <div className="dl-settings">
        <label className="src"><input type="checkbox" checked={dl.wifiOnly} onChange={e => set({ dl: { ...dl, wifiOnly: e.target.checked } })} /> <b>Wi-Fi only</b><small>Wait for Wi-Fi instead of using mobile data.</small></label>
        <label className="src"><b>Storage allowance</b><small>Swarify downloads so far: {mb(used)} of {mb(dl.maxStorageMB * MB)}</small>
          <select value={dl.maxStorageMB} onChange={e => set({ dl: { ...dl, maxStorageMB: +e.target.value } })}>{[512, 1024, 2048, 4096, 8192, 16384, 32768].map(m => <option key={m} value={m}>{mb(m * MB)}</option>)}</select></label>
        <label className="src"><input type="checkbox" checked={dl.auto} onChange={e => set({ dl: { ...dl, auto: e.target.checked } })} /> <b>Auto-download exact matches</b><small>Off by default. When on, exact, verified matches download after matching without asking.</small></label>
      </div>
      {!jobs.length && <p className="empty">No downloads yet.</p>}
      <div className="list">{jobs.map(j => <JobRow key={j.id} j={j} />)}</div>
      {ui.review && <ReviewModal tracks={tracks} playlists={playlists} />}
    </section>
  );
}

function JobRow({ j }: { j: DownloadJob }) {
  const pct = j.total ? Math.min(100, Math.round((j.bytes / j.total) * 100)) : j.state === 'done' ? 100 : 0;
  return (
    <div className={`row static job s-${j.state}`}>
      <Art src={j.art} title={j.title} cls="row-art" />
      <div className="meta"><b>{j.title}</b><span>{j.artist} · {j.source}{j.license ? ` · ${j.license.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}` : ''}</span>
        {(j.state === 'downloading' || j.state === 'paused' || j.state === 'verifying') && <div className="bar"><i style={{ width: `${pct}%` }} /></div>}
        {j.error && <span className="err">{j.error}</span>}</div>
      <span className={`pill-s s-job-${j.state}`}>{STATE[j.state]}{j.state === 'downloading' && j.total ? ` ${pct}%` : ''}</span>
      {['downloading', 'queued', 'waiting_wifi'].includes(j.state) && <button className="chip mini-chip" onClick={() => downloads.pause(j.id)}>Pause</button>}
      {j.state === 'paused' && <button className="chip mini-chip" onClick={() => downloads.resume(j.id)}>Resume</button>}
      {j.state === 'failed' && <button className="chip mini-chip" onClick={() => downloads.retry(j.id)}>Retry</button>}
      {['downloading', 'queued', 'paused', 'waiting_wifi', 'failed'].includes(j.state) && <button className="chip mini-chip danger" onClick={() => downloads.cancel(j.id)}>Cancel</button>}
    </div>
  );
}

function ReviewModal({ tracks, playlists }: { tracks: ImportedTrack[]; playlists: ImportedPlaylist[] }) {
  const dl = useStore(s => s.dl);
  const [items, setItems] = useState<{ t: ImportedTrack; job: NonNullable<Awaited<ReturnType<typeof downloads.eligibility>> & { ok: true }>['job']; pos: number }[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set()); const [msg, setMsg] = useState('');
  const ordered = useMemo(() => orderedTracks(playlists, tracks), [playlists, tracks]);
  useEffect(() => { let live = true; (async () => { const out: NonNullable<typeof items> = []; for (const o of ordered) { if (o.track.import_status !== 'imported') continue; const e = await downloads.eligibility(o.track); if (e.ok) out.push({ t: o.track, job: e.job, pos: o.position }); } if (live) setItems(out); })(); return () => { live = false; }; }, [ordered]);
  const est = (items ?? []).filter(i => sel.has(i.t.id)).reduce((n, i) => n + (i.job.expected_bytes ?? 5 * MB), 0);
  const go = async () => { const r = await downloads.enqueue([...sel]); setMsg(`Queued ${r.queued.length}${r.skipped.length ? ` · skipped ${r.skipped.length}: ${r.skipped.slice(0, 2).map(s => s.reason).join('; ')}` : ''}`); if (r.queued.length) setTimeout(() => setReview(false), 700); };
  return createPortal(
    <div className="modal-bg" onClick={() => setReview(false)}><div className="modal wide" role="dialog" aria-label="Review downloads" onClick={e => e.stopPropagation()}>
      <h2>Review downloads</h2>
      <p className="empty">These recordings were matched and their source explicitly allows downloading. Tick the ones you want — nothing is selected for you.</p>
      {items === null ? <p className="empty">Checking…</p> : !items.length ? <p className="empty">Nothing eligible right now.</p> : (<>
        <div className="acc-actions"><button className="chip" onClick={() => setSel(new Set(items.map(i => i.t.id)))}>Select all</button><button className="chip" onClick={() => setSel(new Set())}>Select none</button></div>
        <div className="list rev">{items.map(i => (
          <label key={i.t.id} className="row static"><input type="checkbox" checked={sel.has(i.t.id)} onChange={() => setSel(s => { const n = new Set(s); n.has(i.t.id) ? n.delete(i.t.id) : n.add(i.t.id); return n; })} />
            <span className="idx">{i.pos}</span><div className="meta"><b>{i.t.song_title}</b><span>{i.t.artist_name || 'Unknown artist'} → {i.job.source} · {i.job.license ? i.job.license.replace(/^https?:\/\/(www\.)?/, '').slice(0, 44) : 'artist-enabled'}{i.job.expected_bytes ? ` · ${mb(i.job.expected_bytes)}` : ''}</span></div>
            <span className="dur">{i.job.duration_ms ? fmt(i.job.duration_ms / 1000) : ''}</span></label>))}</div></>)}
      <p className="empty">Selected: {sel.size} songs · about {mb(est)} · allowance {mb(dl.maxStorageMB * MB)} · {dl.wifiOnly ? 'Wi-Fi only' : 'any network'}</p>
      {msg && <p className="okmsg">{msg}</p>}
      <div className="acc-actions"><button className="chip" onClick={() => setReview(false)}>Close</button><button className="big" disabled={!sel.size} onClick={go}>Download {sel.size || ''} selected</button></div>
    </div></div>, document.body);
}
