import { useEffect, useRef, useState } from 'react';
import { delFile, getFile, putFile } from '../lib/db';
import { VoiceRecorder, compressImage, forJourney, isEmpty, memorySongIds, newMemory, photoKey, voiceKey, type Memory } from '../lib/journey/memories';
import { newPlaylist, set, useStore } from '../lib/store';
import { JOURNEY_TYPES } from '../lib/journey/types';

function Blobby({ id, kind }: { id: string; kind: 'photo' | 'voice' }) {
  const [url, setUrl] = useState('');
  useEffect(() => { let u = ''; getFile(kind === 'photo' ? photoKey(id) : voiceKey(id)).then(b => { if (b) { u = URL.createObjectURL(b); setUrl(u); } }); return () => { if (u) URL.revokeObjectURL(u); }; }, [id, kind]);
  if (!url) return null; return kind === 'photo' ? <img className="mem-photo" src={url} alt="" /> : <audio controls src={url} className="mem-voice" />;
}

export default function JourneyMemories({ onBack }: { onBack: () => void }) {
  const plan = useStore(s => s.journey); const all = useStore(s => s.memories); const local = useStore(s => s.local); const recent = useStore(s => s.recent);
  const key = plan ? `${plan.type}-${plan.created_at}` : 'general'; const label = plan ? `${JOURNEY_TYPES.find(t => t.id === plan.type)!.label} · ${plan.hours}h` : 'My journeys';
  const [draft, setDraft] = useState<Memory>(() => newMemory({ journey: key })); const [msg, setMsg] = useState(''); const [rec, setRec] = useState(false); const recorder = useRef(new VoiceRecorder());
  const mine = forJourney(all, key); const songs = [...recent, ...local].filter((t, i, a) => a.findIndex(x => x.id === t.id) === i).slice(0, 80);
  const photo = async (files: FileList | null) => { if (!files) return; const ids: string[] = []; for (const f of Array.from(files)) { try { const b = await compressImage(f); const id = crypto.randomUUID(); await putFile(photoKey(id), b); ids.push(id); } catch (e) { setMsg((e as Error).message); } } setDraft(d => ({ ...d, photoIds: [...d.photoIds, ...ids] })); };
  const toggleRec = async () => { try { if (!rec) { await recorder.current.start(); setRec(true); setMsg('Recording… tap again to stop'); } else { const { blob } = await recorder.current.stop(); const id = crypto.randomUUID(); await putFile(voiceKey(id), blob); setDraft(d => ({ ...d, voiceIds: [...d.voiceIds, id] })); setRec(false); setMsg('Voice note saved to this draft'); } } catch (e) { setRec(false); setMsg((e as Error).message || 'Could not use the microphone'); } };
  const save = () => { if (isEmpty(draft)) { setMsg('Add a title, note, photo, voice note or favourite song first'); return; } set(s => ({ memories: [{ ...draft, created_at: Date.now() }, ...s.memories] })); setDraft(newMemory({ journey: key })); setMsg('Memory saved on this device'); };
  const remove = async (m: Memory) => { for (const id of m.photoIds) await delFile(photoKey(id)); for (const id of m.voiceIds) await delFile(voiceKey(id)); set(s => ({ memories: s.memories.filter(x => x.id !== m.id) })); };
  const favs = memorySongIds(all, key).map(id => local.find(t => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t);
  return (
    <div className="view">
      <button className="back" onClick={onBack}>← Journey</button><h1>Journey Memories</h1><p className="empty">{label} — private, stored only on this device. Nothing is uploaded.</p>
      <section className="panel mem-form">
        <input className="mem-title" placeholder="Title (e.g. Window seat, 35,000 ft)" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
        <textarea placeholder="Write a short travel memory…" rows={3} value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} />
        <label className="field">Favourite song of this journey<select value={draft.song?.id ?? ''} onChange={e => { const t = songs.find(x => x.id === e.target.value); setDraft({ ...draft, song: t ? { id: t.id, title: t.title, artist: t.artist } : null }); }}><option value="">— none —</option>{songs.map(t => <option key={t.id} value={t.id}>{t.title} — {t.artist}</option>)}</select></label>
        <div className="acc-actions"><label className="chip filebtn">📷 Add photos<input type="file" accept="image/*" multiple hidden onChange={e => photo(e.target.files)} /></label><button className={`chip ${rec ? 'danger' : ''}`} onClick={toggleRec}>{rec ? '⏹ Stop recording' : '🎙 Voice note'}</button><button className="big" onClick={save}>Save memory</button></div>
        <div className="mem-draft">{draft.photoIds.map(id => <Blobby key={id} id={id} kind="photo" />)}{draft.voiceIds.map(id => <Blobby key={id} id={id} kind="voice" />)}</div>
        {msg && <p className="scan-msg">{msg}</p>}
      </section>
      {favs.length > 0 && <div className="acc-actions"><button className="chip" onClick={() => { newPlaylist(`${label} favourites`, favs); setMsg('Journey playlist saved in your Library'); }}>Create journey playlist from favourites ({favs.length})</button></div>}
      <h2>Memories <small className="count">{mine.length}</small></h2>
      {!mine.length && <p className="empty">No memories for this journey yet.</p>}
      {mine.map(m => <section className="panel mem" key={m.id}><div className="sec-h"><h2>{m.title || 'Untitled'}</h2><small className="count">{new Date(m.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</small><button className="chip mini-chip danger" onClick={() => remove(m)}>Delete</button></div>
        {m.text && <p>{m.text}</p>}{m.song && <p className="empty">♪ {m.song.title} — {m.song.artist}</p>}<div className="mem-draft">{m.photoIds.map(id => <Blobby key={id} id={id} kind="photo" />)}{m.voiceIds.map(id => <Blobby key={id} id={id} kind="voice" />)}</div></section>)}
    </div>
  );
}
