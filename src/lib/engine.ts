import { current, getState, hooks, saveAudioProgress, set, step, useStore } from './store';
import { getFile } from './db';
import { resolveSrc } from './scan';
import { hasNativePlayer } from './native';
import { initNative, syncNative, useNativeTime } from './engine.native';
import { useEffect, useState } from 'react';

export const audio = new Audio(); // web/browser engine only — never touched inside the Android app
audio.preload = 'auto';
const BANDS = [60, 230, 910, 3600, 14000];
let ctx: AudioContext | null = null;
let filters: BiquadFilterNode[] = [];
let wired = false;

function wireEq() {
  if (wired) return;
  try {
    ctx = new AudioContext();
    const src = ctx.createMediaElementSource(audio);
    filters = BANDS.map((f, i) => { const b = ctx!.createBiquadFilter(); b.type = i === 0 ? 'lowshelf' : i === 4 ? 'highshelf' : 'peaking'; b.frequency.value = f; b.gain.value = getState().eq[i]; return b; });
    src.connect(filters[0]); filters.forEach((f, i) => i < 4 && f.connect(filters[i + 1])); filters[4].connect(ctx.destination);
    wired = true;
  } catch { /* unsupported */ }
}
export function setEq(i: number, g: number) {
  const eq = [...getState().eq]; eq[i] = g; set({ eq });
  if (hasNativePlayer) return; // native service applies it via the store sync
  if (g !== 0 || wired) { wireEq(); ctx?.resume(); if (filters[i]) filters[i].gain.value = g; }
}
export const EQ_LABELS = ['60Hz', '230Hz', '910Hz', '3.6k', '14k'];

let loadedId = '';
let resumed = false;
let objUrl = '';
async function load(id: string, url: string) {
  if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = ''; }
  let src = url;
  if (url.startsWith('local:')) {
    const b = await getFile(url.slice(6));
    if (!b) { step(1, true); return; }
    src = objUrl = URL.createObjectURL(b);
  }
  // CORS-enabled load is needed for the equalizer; fall back to a plain load if the host refuses.
  audio.crossOrigin = wired ? 'anonymous' : null;
  audio.src = resolveSrc(src);
  loadedId = id;
  const sa = getState().startAt;
  if (sa && sa.id === id) { const pos = sa.pos; audio.addEventListener('loadedmetadata', () => { audio.currentTime = pos; }, { once: true }); set({ startAt: null }); }
  const r = getState().resume;
  if (!resumed && r && r.track.id === id && r.pos > 1) { const pos = r.pos; audio.addEventListener('loadedmetadata', () => { audio.currentTime = pos; }, { once: true }); }
  resumed = true;
}

let fading = false;
function tick() {
  const s = getState(); const cf = s.crossfade;
  if (!audio.duration || !isFinite(audio.duration)) return;
  const left = audio.duration - audio.currentTime;
  if (cf > 0 && left < cf && s.playing && s.repeat !== 'one') { fading = true; audio.volume = Math.max(0, (left / cf)) * s.volume; }
  else if (cf > 0 && audio.currentTime < Math.min(cf, 3)) { audio.volume = Math.min(1, audio.currentTime / Math.min(cf, 3)) * s.volume; }
  else if (fading || audio.volume !== s.volume) { fading = false; audio.volume = s.volume; }
  if (s.sleepAt && Date.now() >= s.sleepAt) { set({ playing: false, sleepAt: null }); }
}
if (!hasNativePlayer) setInterval(tick, 250);
if (!hasNativePlayer) setInterval(() => {
  const t = current(); if (!t || audio.paused || !audio.currentTime) return;
  set({ resume: { track: t, pos: audio.currentTime, dur: isFinite(audio.duration) ? audio.duration : 0 } }); saveAudioProgress(t, audio.currentTime, isFinite(audio.duration) ? audio.duration : 0);
}, 5000);

audio.addEventListener('ended', () => step(1, true));
audio.addEventListener('error', () => {
  // retry once without CORS, otherwise skip
  if (audio.crossOrigin) { audio.crossOrigin = null; const t = audio.currentTime; audio.load(); audio.currentTime = t; audio.play().catch(() => {}); }
  else setTimeout(() => step(1, true), 800);
});

// React to store changes
let last = { id: '', playing: false };
export function startEngine() {
  const sync = async () => {
    const s = getState(); const t = current(s);
    if (!t) { audio.pause(); return; }
    if (t.id !== loadedId || (s.repeat === 'one' && last.id === t.id && audio.ended)) {
      await load(t.id, t.url);
      updateMedia(t);
    }
    if (s.playing) { ctx?.resume(); audio.play().catch(() => {}); } else audio.pause();
    if (!fading) audio.volume = s.volume;
    last = { id: t.id, playing: s.playing };
  };
  return sync;
}

function updateMedia(t: { title: string; artist: string; album?: string; art: string }) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album || '', artwork: [{ src: t.art, sizes: '512x512' }] });
  navigator.mediaSession.setActionHandler('play', () => set({ playing: true }));
  navigator.mediaSession.setActionHandler('pause', () => set({ playing: false }));
  navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
  navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
  navigator.mediaSession.setActionHandler('seekto', d => { if (d.seekTime != null) audio.currentTime = d.seekTime; });
}

export function useTime() {
  const nt = useNativeTime();
  const [t, setT] = useState({ cur: 0, dur: 0 });
  useEffect(() => {
    const f = () => setT({ cur: audio.currentTime, dur: isFinite(audio.duration) ? audio.duration : 0 });
    audio.addEventListener('timeupdate', f); audio.addEventListener('loadedmetadata', f);
    return () => { audio.removeEventListener('timeupdate', f); audio.removeEventListener('loadedmetadata', f); };
  }, []);
  return hasNativePlayer ? nt : t;
}
export const seek = (s: number) => { if (hasNativePlayer) { hooks.seek?.(s); return; } audio.currentTime = s; };
export function useEngine() {
  // subscribe to the pieces of state that drive playback
  const id = useStore(s => current(s)?.id);
  const playing = useStore(s => s.playing);
  const vol = useStore(s => s.volume);
  const rep = useStore(s => s.repeat);
  const idx = useStore(s => s.index); const queue = useStore(s => s.queue); const shuffle = useStore(s => s.shuffle);
  const eq = useStore(s => s.eq); const cf = useStore(s => s.crossfade); const sleepAt = useStore(s => s.sleepAt);
  const [sync] = useState(() => (hasNativePlayer ? () => syncNative() : startEngine()));
  useEffect(() => { sync(); }, [id, playing, vol, rep, idx, queue, shuffle, eq, cf, sleepAt, sync]);
  useEffect(() => (hasNativePlayer ? initNative() : undefined), []);
}
