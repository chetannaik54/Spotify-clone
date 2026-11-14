/**
 * Native playback engine. The Android foreground service (ExoPlayer + MediaSession) owns playback and the
 * live queue; this module mirrors the JS store into it and mirrors native events back into the store.
 * The store stays the persisted source of truth for UI (queue, liked, playlists…).
 */
import { useSyncExternalStore } from 'react';
import { NativePlayer, type NativeState, type NativeTrack } from './native';
import { current, getState, hooks, saveAudioProgress, set } from './store';
import type { Track } from './types';

const ns = { count: 0, index: -1, playing: false, currentId: '', shuffle: false, repeat: 'off' as 'off' | 'one' | 'all', sleepAt: 0, eq: '' , cf: -1, vol: -1 };
let lastQ: Track[] | null = null;
let resumeUsed = false;
let askedNotif = false;
let quietUntil = 0;
let started = false;
let ready = false; // do not push anything to native until the running session (if any) has been adopted

// ---- time (for seek bar / lyrics) ----
let tm = { cur: 0, dur: 0 };
const tsubs = new Set<() => void>();
const setTime = (cur: number, dur: number) => { tm = { cur, dur: dur || tm.dur }; tsubs.forEach(f => f()); };
export const useNativeTime = () => useSyncExternalStore(cb => { tsubs.add(cb); return () => tsubs.delete(cb); }, () => tm);

const art = (a?: string) => (a && /^(https?|content|file):\/\//.test(a) ? a : '');
const toNative = (t: Track): NativeTrack => ({ id: t.id, title: t.title, artist: t.artist, album: t.album ?? '', art: art(t.art), url: t.url });

let chain: Promise<unknown> = Promise.resolve();
export function syncNative() { if (!ready) return; chain = chain.then(doSync).catch(e => console.warn('native sync failed', e)); }

async function pushQueue() {
  const s = getState(); const cur = s.queue[s.index];
  if (!cur) return;
  const keep = ns.count > 0 && ns.currentId === cur.id;
  let pos = 0;
  if (s.startAt && s.startAt.id === cur.id) { pos = s.startAt.pos; set({ startAt: null }); }          // explicit start position (quiz clips, audio-library resume)
  else if (!keep && !resumeUsed && s.resume && s.resume.track.id === cur.id) pos = s.resume.pos;
  if (!keep) resumeUsed = true;
  if (s.playing && !askedNotif) { askedNotif = true; NativePlayer.requestNotifications().catch(() => {}); }
  quietUntil = Date.now() + 600;
  await NativePlayer.setQueue({ tracks: s.queue.map(toNative), index: s.index, position: pos, play: s.playing, keepCurrent: keep });
  lastQ = s.queue; ns.count = s.queue.length; ns.index = s.index; ns.currentId = cur.id; ns.playing = s.playing;
  quietUntil = Date.now() + 600;
  setTimeout(() => refresh(), 700); // settle: apply authoritative native state after the queue edit finishes
}

/** Ignore native events briefly after a UI command, then re-read the authoritative state. */
function settle() { quietUntil = Date.now() + 500; setTimeout(() => refresh(), 650); }

async function doSync() {
  const s = getState();
  if (!s.queue.length) return;
  if (s.queue !== lastQ) {
    if (s.playing || ns.count > 0) await pushQueue();
  } else if (ns.count > 0) {
    if (s.index !== ns.index) { settle(); await NativePlayer.skipTo({ index: s.index }); ns.index = s.index; }
    if (s.playing !== ns.playing) { settle(); await (s.playing ? NativePlayer.play() : NativePlayer.pause()); ns.playing = s.playing; }
  } else if (s.playing) await pushQueue();

  if (s.shuffle !== ns.shuffle) { await NativePlayer.setShuffle({ enabled: s.shuffle }); ns.shuffle = s.shuffle; }
  if (s.repeat !== ns.repeat) { await NativePlayer.setRepeat({ mode: s.repeat }); ns.repeat = s.repeat; }
  const eqk = s.eq.join(',');
  if (eqk !== ns.eq) { await NativePlayer.setEq({ gains: s.eq }); ns.eq = eqk; }
  if (s.crossfade !== ns.cf) { await NativePlayer.setCrossfade({ seconds: s.crossfade }); ns.cf = s.crossfade; }
  if (s.volume !== ns.vol) { await NativePlayer.setVolume({ volume: s.volume }); ns.vol = s.volume; }
  const sl = s.sleepAt ?? 0;
  if (sl !== ns.sleepAt) { await NativePlayer.setSleep({ at: sl }); ns.sleepAt = sl; }
}

const sameQueue = (s: ReturnType<typeof getState>, st: NativeState) => st.count > 0 && s.queue.length === st.count && s.queue.every((t, i) => t.id === st.ids[i]);

/** Apply native state to the store (index / playing). `adopt` also takes over the queue/modes when they differ. */
function apply(st: NativeState, adopt = false) {
  ns.count = st.count; ns.index = st.index; ns.playing = st.playing; ns.currentId = st.currentId ?? '';
  if (st.shuffle != null) ns.shuffle = st.shuffle;
  if (st.repeat) ns.repeat = st.repeat;
  const s = getState(); const p: Record<string, unknown> = {};
  const same = sameQueue(s, st);
  if (st.count > 0 && !same && adopt && st.tracks) {
    p.queue = st.tracks.map<Track>(t => ({ id: t.id, title: t.title, artist: t.artist, album: t.album, art: t.art ?? '', url: t.url, source: t.url.startsWith('content:') ? 'local' : 'itunes' }));
  }
  if (st.count > 0 && (same || p.queue)) {
    if (st.index !== s.index) {
      p.index = st.index;
      const tr = (p.queue as Track[] | undefined)?.[st.index] ?? s.queue[st.index];
      if (tr) p.recent = [tr, ...s.recent.filter(x => x.id !== tr.id)].slice(0, 30);
    }
    if (st.playing !== s.playing) p.playing = st.playing;
    if (adopt && st.shuffle != null && st.shuffle !== s.shuffle) p.shuffle = st.shuffle;
    if (adopt && st.repeat && st.repeat !== s.repeat) p.repeat = st.repeat;
  }
  if (s.sleepAt && Date.now() >= s.sleepAt) { p.sleepAt = null; ns.sleepAt = 0; }
  if (Object.keys(p).length) set(p as Parameters<typeof set>[0]);
  if (st.count > 0 && (same || p.queue)) lastQ = getState().queue;   // native and JS now hold the same queue
  if (st.position != null) setTime(st.position, st.duration ?? 0);
}

export async function refresh(adopt = false) {
  try { apply(await NativePlayer.getState({ full: adopt }), adopt); } catch (e) { console.warn('getState failed', e); }
}

export function initNative(): () => void {
  if (started) return () => {}; started = true;
  hooks.step = dir => { (dir === 1 ? NativePlayer.next() : NativePlayer.previous()).catch(() => {}); return true; };
  hooks.seek = s => { NativePlayer.seekTo({ position: s }).catch(() => {}); setTime(s, tm.dur); };
  const subs: Promise<{ remove(): Promise<void> }>[] = [];
  subs.push(NativePlayer.addListener('state', st => { if (Date.now() < quietUntil) return; apply(st); }));
  let lastSave = 0;
  subs.push(NativePlayer.addListener('time', t => {
    setTime(t.position, t.duration);
    const tr = current(); const now = Date.now();
    if (tr && now - lastSave > 5000) { lastSave = now; set({ resume: { track: tr, pos: t.position, dur: t.duration } }); saveAudioProgress(tr, t.position, t.duration); }
  }));
  subs.push(NativePlayer.addListener('error', e => console.warn('native player error:', e.message)));
  const vis = () => { if (document.visibilityState === 'visible') refresh(); };
  document.addEventListener('visibilitychange', vis);
  refresh(true).finally(() => { ready = true; syncNative(); });   // adopt a still-running service after app recreation
  return () => { started = false; ready = false; hooks.step = null; hooks.seek = null; document.removeEventListener('visibilitychange', vis); subs.forEach(p => p.then(h => h.remove()).catch(() => {})); };
}
