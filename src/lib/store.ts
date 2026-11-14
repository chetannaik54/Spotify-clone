import { useSyncExternalStore } from 'react';
import type { Playlist, Track } from './types';
import type { JourneyPlan } from './journey/types';

type State = {
  queue: Track[]; index: number; playing: boolean; shuffle: boolean; repeat: 'off' | 'all' | 'one';
  liked: Track[]; playlists: Playlist[]; recent: Track[]; local: Track[];
  journey: JourneyPlan | null; journeyVerified: { passed: boolean; at: number } | null; resume: { track: Track; pos: number; dur: number } | null; jamendoId: string; eq: number[]; crossfade: number; sleepAt: number | null; volume: number;
};
const KEY = 'swarify-state-v1';
const defaults: State = {
  queue: [], index: -1, playing: false, shuffle: false, repeat: 'off', liked: [], playlists: [], recent: [], local: [],
  journey: null, journeyVerified: null, resume: null, jamendoId: '', eq: [0, 0, 0, 0, 0], crossfade: 0, sleepAt: null, volume: 1,
};
let state: State = (() => { try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}'), playing: false, sleepAt: null }; } catch { return defaults; } })();
const subs = new Set<() => void>();
export const getState = () => state;
export function set(p: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof p === 'function' ? p(state) : p) };
  try { localStorage.setItem(KEY, JSON.stringify({ ...state, playing: false })); } catch { /* quota */ }
  subs.forEach(f => f());
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => sel(state));
}
/** Native engine installs these so UI actions go to the Android service instead of the JS queue logic. */
export const hooks: { step: ((dir: 1 | -1) => boolean) | null; seek: ((s: number) => void) | null } = { step: null, seek: null };
export const current = (s = state) => s.queue[s.index] as Track | undefined;

export function playList(tracks: Track[], start = 0) {
  set(s => ({ queue: tracks, index: start, playing: true, recent: [tracks[start], ...s.recent.filter(t => t.id !== tracks[start].id)].slice(0, 30) }));
}
export function toggleLike(t: Track) {
  set(s => ({ liked: s.liked.some(x => x.id === t.id) ? s.liked.filter(x => x.id !== t.id) : [t, ...s.liked] }));
}
export function addToQueue(t: Track, next = false) {
  set(s => { const q = [...s.queue]; q.splice(next ? s.index + 1 : q.length, 0, t); return { queue: q, index: s.index < 0 ? 0 : s.index, playing: s.index < 0 ? true : s.playing }; });
}
export function step(dir: 1 | -1, auto = false) {
  if (hooks.step && hooks.step(dir)) return;
  set(s => {
    if (!s.queue.length) return {};
    if (auto && s.repeat === 'one') return { playing: true, index: s.index };
    let i = s.index;
    if (s.shuffle && dir === 1) i = Math.floor(Math.random() * s.queue.length);
    else i += dir;
    if (i >= s.queue.length) { if (s.repeat === 'all' || !auto) i = 0; else return { playing: false }; }
    if (i < 0) i = s.queue.length - 1;
    const t = s.queue[i];
    return { index: i, playing: true, recent: [t, ...s.recent.filter(x => x.id !== t.id)].slice(0, 30) };
  });
}
export function newPlaylist(name: string, tracks: Track[] = []) {
  set(s => ({ playlists: [...s.playlists, { id: crypto.randomUUID(), name, tracks }] }));
}
export function addToPlaylist(pid: string, t: Track) {
  set(s => ({ playlists: s.playlists.map(p => p.id === pid && !p.tracks.some(x => x.id === t.id) ? { ...p, tracks: [...p.tracks, t] } : p) }));
}
