import type { Track } from '../types';

export type QuizMode = 'song' | 'singer' | 'movie' | 'year' | 'lyrics' | 'trivia';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Question = { id: string; mode: QuizMode; prompt: string; trackId?: string; audio: boolean; clipStart: number; clipSec: number; options: string[]; answer: number; timeSec: number; reveal: string };
export type BoardEntry = { score: number; mode: QuizMode; diff: Difficulty; correct: number; total: number; bestStreak: number; at: number };

export const MODES: { id: QuizMode; label: string; blurb: string; audio: boolean }[] = [
  { id: 'song', label: 'Guess the song', blurb: 'Hear a clip, name the song', audio: true },
  { id: 'singer', label: 'Guess the singer', blurb: 'Hear a clip, name the artist', audio: true },
  { id: 'movie', label: 'Guess the movie', blurb: 'Hear a clip, name the film / album', audio: true },
  { id: 'year', label: 'Guess the year', blurb: 'Hear a clip, pick the release year', audio: true },
  { id: 'lyrics', label: 'Complete the lyrics', blurb: 'Pick the next line (needs stored lyrics)', audio: false },
  { id: 'trivia', label: 'Music trivia', blurb: 'Questions about your own collection', audio: false },
];
export const DIFF = { easy: { options: 3, clip: 15, time: 25, mult: 1 }, medium: { options: 4, clip: 10, time: 18, mult: 1.5 }, hard: { options: 5, clip: 6, time: 12, mult: 2 } } as const;

export type Rng = () => number;
export const mulberry32 = (seed: number): Rng => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = <T,>(a: T[], r: Rng) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

const GENERIC = /^(unknown( artist| album)?|various artists|my music|<unknown>|singles|downloads?|music|audio|recordings?|imported)$/i;
export const known = (v?: string) => !!v && !GENERIC.test(v.trim());
const clean = (s: string) => s.replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').replace(/\s*\|.*$/, '').replace(/\s+/g, ' ').trim() || s;
export const primaryArtist = (a: string) => a.split(/[,;&]/)[0].trim();

function pickOptions(correct: string, pool: string[], n: number, r: Rng): string[] | null {
  const uniq = [...new Set(pool.map(p => p.trim()).filter(p => p && p.toLowerCase() !== correct.toLowerCase()))];
  if (uniq.length < n - 1) return null;
  const opts = shuffle([correct, ...shuffle(uniq, r).slice(0, n - 1)], r); return opts;
}

export type QuizInput = { tracks: Track[]; lyrics?: Map<string, string[]> };
/** Build questions from the user's OWN library. Nothing is fetched. Returns a reason when the library can't support the mode. */
export function makeQuestions(inp: QuizInput, mode: QuizMode, diff: Difficulty, count: number, rng: Rng = Math.random): { questions: Question[]; problem?: string } {
  const D = DIFF[diff]; const local = inp.tracks.filter(t => t.source === 'local' && t.url); const qs: Question[] = [];
  const clipStart = (t: Track) => { const d = t.duration ?? 0; return d > D.clip * 3 ? Math.round(d * (0.2 + rng() * 0.4)) : Math.min(20, Math.max(0, Math.round((d - D.clip) / 2))); };
  const mk = (t: Track, prompt: string, opts: string[], ans: string, reveal: string, audio: boolean): Question => ({ id: `${mode}-${t.id}-${qs.length}`, mode, prompt, trackId: t.id, audio, clipStart: audio ? Math.max(0, clipStart(t)) : 0, clipSec: D.clip, options: opts, answer: opts.indexOf(ans), timeSec: D.time, reveal });
  const title = (t: Track) => clean(t.title);
  if (mode === 'song') {
    const titles = [...new Set(local.map(title))]; const pool = shuffle(local, rng);
    for (const t of pool) { if (qs.length >= count) break;
      const same = diff === 'hard' ? local.filter(x => x.id !== t.id && known(x.artist) && x.artist === t.artist).map(title) : []; const opts = pickOptions(title(t), [...same, ...titles], D.options, rng); if (!opts) continue;
      qs.push(mk(t, 'Which song is playing?', opts, title(t), `${title(t)}${known(t.artist) ? ' — ' + primaryArtist(t.artist) : ''}`, true)); }
  } else if (mode === 'singer') {
    const withA = local.filter(t => known(t.artist)); const artists = [...new Set(withA.map(t => primaryArtist(t.artist)))];
    for (const t of shuffle(withA, rng)) { if (qs.length >= count) break; const opts = pickOptions(primaryArtist(t.artist), artists, D.options, rng); if (!opts) continue; qs.push(mk(t, 'Who is singing?', opts, primaryArtist(t.artist), `${primaryArtist(t.artist)} — ${title(t)}`, true)); }
    if (!qs.length) return { questions: [], problem: withA.length ? 'Your songs have too few different artists for this mode' : 'Your songs have no artist tags — scan the device so tags are read' };
  } else if (mode === 'movie') {
    const withB = local.filter(t => known(t.album)); const albums = [...new Set(withB.map(t => clean(t.album!)))];
    for (const t of shuffle(withB, rng)) { if (qs.length >= count) break; const opts = pickOptions(clean(t.album!), albums, D.options, rng); if (!opts) continue; qs.push(mk(t, 'Which film / album is this from?', opts, clean(t.album!), `${clean(t.album!)} — ${title(t)}`, true)); }
    if (!qs.length) return { questions: [], problem: withB.length ? 'Your songs belong to too few different albums for this mode' : 'Your songs have no album/film tags' };
  } else if (mode === 'year') {
    const withY = local.filter(t => (t.year ?? 0) >= 1900); 
    for (const t of shuffle(withY, rng)) { if (qs.length >= count) break; const y = t.year!; const near = [y - 1, y + 1, y - 2, y + 2, y - 4, y + 3, y - 6, y + 5].filter(v => v !== y && v <= new Date().getFullYear()).slice(0, 8);
      const opts = pickOptions(String(y), diff === 'easy' ? [y - 12, y + 9, y - 20, y + 15, y - 7].filter(v => v > 1900).map(String) : near.map(String), D.options, rng); if (!opts) continue; qs.push(mk(t, 'Which year was this released?', opts, String(y), `${y} — ${title(t)}`, true)); }
    if (!qs.length) return { questions: [], problem: 'Your songs have no release-year tags' };
  } else if (mode === 'lyrics') {
    const ls = inp.lyrics ?? new Map(); const withL = local.filter(t => (ls.get(t.id)?.length ?? 0) >= 6);
    const allLines = [...ls.values()].flat().filter((l: string) => l.length > 8);
    for (const t of shuffle(withL, rng)) { if (qs.length >= count) break; const lines = ls.get(t.id)!.filter((l: string) => l.length > 8); if (lines.length < 4) continue;
      const i = 1 + Math.floor(rng() * (lines.length - 2)); const next = lines[i + 1]; if (!next) continue; const opts = pickOptions(next, allLines.filter((l: string) => !lines.slice(i, i + 2).includes(l)), D.options, rng); if (!opts) continue;
      qs.push({ ...mk(t, `“${lines[i]}”  →  what comes next?`, opts, next, `${next} — ${title(t)}`, false), clipSec: 0 }); }
    if (!qs.length) return { questions: [], problem: 'Not enough songs have lyrics stored on this device — use “Cache lyrics” in Journey while online' };
  } else {   // trivia: text-only facts about the library
    const kinds: (() => Question | null)[] = [
      () => { const t = shuffle(local.filter(x => known(x.artist)), rng)[0]; if (!t) return null; const o = pickOptions(primaryArtist(t.artist), local.filter(x => known(x.artist)).map(x => primaryArtist(x.artist)), D.options, rng); return o && { ...mk(t, `Who sang “${title(t)}”?`, o, primaryArtist(t.artist), `${primaryArtist(t.artist)}`, false), clipSec: 0 }; },
      () => { const t = shuffle(local.filter(x => known(x.album)), rng)[0]; if (!t) return null; const o = pickOptions(clean(t.album!), local.filter(x => known(x.album)).map(x => clean(x.album!)), D.options, rng); return o && { ...mk(t, `“${title(t)}” is from which film / album?`, o, clean(t.album!), clean(t.album!), false), clipSec: 0 }; },
      () => { const t = shuffle(local.filter(x => (x.year ?? 0) >= 1900), rng)[0]; if (!t) return null; const y = t.year!; const o = pickOptions(String(y), [y - 1, y + 1, y - 3, y + 2, y - 5, y + 4].map(String), D.options, rng); return o && { ...mk(t, `Which year is “${title(t)}” from?`, o, String(y), String(y), false), clipSec: 0 }; },
      () => { const by = new Map<string, number>(); for (const t of local) if (known(t.artist)) by.set(primaryArtist(t.artist), (by.get(primaryArtist(t.artist)) ?? 0) + 1); const top = [...by].sort((a, b) => b[1] - a[1]); if (top.length < D.options) return null; const o = shuffle(top.slice(0, D.options).map(x => x[0]), rng); const t = local[0]; return { ...mk(t, 'Which artist has the most songs in your library?', o, top[0][0], `${top[0][0]} (${top[0][1]} songs)`, false), clipSec: 0, trackId: undefined }; },
    ];
    let guard = 0; while (qs.length < count && guard++ < count * 6) { const q = kinds[Math.floor(rng() * kinds.length)](); if (q && !qs.some(x => x.prompt === q.prompt)) qs.push(q); }
  }
  if (!qs.length) return { questions: [], problem: 'Not enough songs in your library for this mode (need at least a handful)' };
  return { questions: qs.slice(0, count) };
}

/** Points for one answer. Wrong or timed-out = 0. Speed bonus up to +50 %, difficulty multiplier, streak multiplier up to ×2. */
export function scoreAnswer(correct: boolean, timeLeft: number, diff: Difficulty, streakBefore: number, total: number = DIFF[diff].time): number {
  if (!correct) return 0; const speed = 1 + 0.5 * Math.max(0, Math.min(1, timeLeft / total)); const streak = 1 + 0.1 * Math.min(10, streakBefore);
  return Math.round(100 * DIFF[diff].mult * speed * streak);
}
export const addToBoard = (board: BoardEntry[], e: BoardEntry, max = 10) => [...board, e].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, max);
