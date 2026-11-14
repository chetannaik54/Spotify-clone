import { describe, expect, it } from 'vitest';
import { DIFF, addToBoard, makeQuestions, mulberry32, scoreAnswer, type BoardEntry } from '../src/lib/journey/quiz';
import { buildMoodMix, moodScore } from '../src/lib/journey/mood';
import { addItem, byKind, episodeOrder, resolveItems, suggestCategory } from '../src/lib/journey/library';
import { forJourney, isEmpty, memorySongIds, newMemory } from '../src/lib/journey/memories';
import type { Track } from '../src/lib/types';

const T = (i: number, o: Partial<Track> = {}): Track => ({ id: `lo-${i}`, title: `Song ${i}`, artist: ['Arijit Singh', 'Kumar Sanu', 'Alka Yagnik', 'Udit Narayan', 'Sonu Nigam', 'Shreya Ghoshal'][i % 6], album: `Film ${i % 7}`, year: 1990 + (i % 25), art: '', url: `content://m/${i}`, source: 'local', duration: 240, ...o });
const lib = Array.from({ length: 40 }, (_, i) => T(i));

describe('quiz generation (from the user\'s own library only)', () => {
  it.each(['song', 'singer', 'movie', 'year'] as const)('%s: audio questions with the right option count, exactly one correct, answer present, only local tracks', mode => {
    for (const diff of ['easy', 'medium', 'hard'] as const) {
      const { questions, problem } = makeQuestions({ tracks: lib }, mode, diff, 10, mulberry32(7)); expect(problem).toBeUndefined(); expect(questions.length).toBe(10);
      for (const q of questions) { expect(q.audio).toBe(true); expect(q.options.length).toBe(DIFF[diff].options); expect(new Set(q.options).size).toBe(q.options.length); expect(q.answer).toBeGreaterThanOrEqual(0); expect(q.clipSec).toBe(DIFF[diff].clip); expect(lib.some(t => t.id === q.trackId && t.url.startsWith('content:'))).toBe(true); }
    }
  });
  it('the marked answer is really the track\'s title / artist / album / year', () => {
    const t = (id: string) => lib.find(x => x.id === id)!;
    for (const q of makeQuestions({ tracks: lib }, 'singer', 'medium', 8, mulberry32(1)).questions) expect(q.options[q.answer]).toBe(t(q.trackId!).artist);
    for (const q of makeQuestions({ tracks: lib }, 'year', 'medium', 8, mulberry32(2)).questions) expect(q.options[q.answer]).toBe(String(t(q.trackId!).year));
    for (const q of makeQuestions({ tracks: lib }, 'movie', 'easy', 8, mulberry32(3)).questions) expect(q.options[q.answer]).toBe(t(q.trackId!).album);
  });
  it('harder = more options, shorter clips, less time', () => { expect(DIFF.easy.options).toBeLessThan(DIFF.hard.options); expect(DIFF.easy.clip).toBeGreaterThan(DIFF.hard.clip); expect(DIFF.easy.time).toBeGreaterThan(DIFF.hard.time); });
  it('clips start inside the song, never past its end', () => { for (const q of makeQuestions({ tracks: lib }, 'song', 'hard', 15, mulberry32(4)).questions) { expect(q.clipStart).toBeGreaterThanOrEqual(0); expect(q.clipStart + q.clipSec).toBeLessThanOrEqual(240); } });
  it('online songs (previews/streams) are never used for audio questions', () => {
    const mixed = [...lib.slice(0, 10), ...Array.from({ length: 20 }, (_, i) => T(100 + i, { source: 'itunes', url: 'https://x/p.m4a', preview: true }))];
    for (const q of makeQuestions({ tracks: mixed }, 'song', 'easy', 10, mulberry32(5)).questions) expect(lib.slice(0, 10).some(t => t.id === q.trackId)).toBe(true);
  });
  it('explains why when the library cannot support a mode (no tags / too few songs / no lyrics)', () => {
    expect(makeQuestions({ tracks: lib.map(t => ({ ...t, artist: 'Unknown artist' })) }, 'singer', 'easy', 5).problem).toMatch(/no artist tags/);
    expect(makeQuestions({ tracks: lib.map(t => ({ ...t, year: undefined })) }, 'year', 'easy', 5).problem).toMatch(/no release-year/);
    expect(makeQuestions({ tracks: lib.map(t => ({ ...t, album: 'Singles' })) }, 'movie', 'easy', 5).problem).toMatch(/no album/);
    expect(makeQuestions({ tracks: lib }, 'lyrics', 'easy', 5).problem).toMatch(/lyrics stored/); expect(makeQuestions({ tracks: lib.slice(0, 2) }, 'song', 'easy', 5).problem).toMatch(/Not enough songs/);
  });
  it('lyrics mode: the correct option is the actual next line, from stored lyrics', () => {
    const lyrics = new Map(lib.slice(0, 8).map((t, i) => [t.id, Array.from({ length: 10 }, (_, k) => `line ${i}-${k} of the song text`)]));
    const { questions } = makeQuestions({ tracks: lib.slice(0, 8), lyrics }, 'lyrics', 'medium', 5, mulberry32(9)); expect(questions.length).toBe(5);
    for (const q of questions) { const lines = lyrics.get(q.trackId!)!; const m = /“(.+)”/.exec(q.prompt)![1]; expect(q.audio).toBe(false); expect(q.options[q.answer]).toBe(lines[lines.indexOf(m) + 1]); }
  });
  it('trivia is text-only and answerable', () => { const { questions } = makeQuestions({ tracks: lib }, 'trivia', 'medium', 6, mulberry32(11)); expect(questions.length).toBe(6); for (const q of questions) { expect(q.audio).toBe(false); expect(q.options[q.answer]).toBeTruthy(); } });
  it('is deterministic for a given seed', () => { const a = makeQuestions({ tracks: lib }, 'song', 'easy', 5, mulberry32(42)).questions.map(q => q.id), b = makeQuestions({ tracks: lib }, 'song', 'easy', 5, mulberry32(42)).questions.map(q => q.id); expect(a).toEqual(b); });
});

describe('scoring, streaks and the local leaderboard', () => {
  it('wrong or timed-out answers score 0', () => { expect(scoreAnswer(false, 20, 'easy', 5)).toBe(0); });
  it('faster, harder and longer streaks score more', () => {
    expect(scoreAnswer(true, 25, 'easy', 0)).toBe(150); expect(scoreAnswer(true, 0, 'easy', 0)).toBe(100); expect(scoreAnswer(true, 12, 'hard', 0)).toBeGreaterThan(scoreAnswer(true, 12, 'easy', 0));
    expect(scoreAnswer(true, 10, 'medium', 4)).toBeGreaterThan(scoreAnswer(true, 10, 'medium', 0)); expect(scoreAnswer(true, 10, 'medium', 50)).toBe(scoreAnswer(true, 10, 'medium', 10));   // streak bonus capped
  });
  it('leaderboard keeps the best 10, highest first', () => {
    let b: BoardEntry[] = []; for (let i = 0; i < 14; i++) b = addToBoard(b, { score: i * 10, mode: 'song', diff: 'easy', correct: 1, total: 5, bestStreak: 1, at: i });
    expect(b.length).toBe(10); expect(b[0].score).toBe(130); expect(b[9].score).toBe(40);
  });
});

describe('Mood DJ (tag/keyword based — honest about not analysing audio)', () => {
  const tr = (title: string, o: Partial<Track> = {}) => T(Math.floor(Math.random() * 1e6), { title, ...o });
  it('recognises mood evidence in titles, genres and years', () => {
    expect(moodScore(tr('Tum Hi Ho'), 'romantic').score).toBeGreaterThanOrEqual(3); expect(moodScore(tr('Channa Mereya - Dard'), 'sad').score).toBeGreaterThanOrEqual(3); expect(moodScore(tr('Nachle Party Anthem'), 'energetic').score).toBeGreaterThanOrEqual(3);
    expect(moodScore(tr('X', { genre: 'Sufi' }), 'relaxing').score).toBeGreaterThanOrEqual(3); expect(moodScore(tr('Track Nine', { year: 1985 }), 'nostalgic', undefined, false, 2026).score).toBeGreaterThanOrEqual(3); expect(moodScore(tr('Track Nine', { year: 2024 }), 'nostalgic', undefined, false, 2026).score).toBe(0);
  });
  it('user feedback beats keywords (teaches the DJ)', () => { const t = tr('Tum Hi Ho'); expect(moodScore(t, 'sad', { sad: 1 }).score).toBeGreaterThan(5); expect(moodScore(t, 'romantic', { romantic: -1 }).score).toBeLessThan(0); });
  it('builds a mix of the requested length from matching songs, no artist twice in a row, no duplicates', () => {
    const songs = [...Array.from({ length: 12 }, (_, i) => T(i, { title: `Pyaar ke geet ${i}`, artist: i % 2 ? 'A' : 'B' })), ...Array.from({ length: 20 }, (_, i) => T(50 + i, { title: `Random ${i}` }))];
    const m = buildMoodMix(songs, 'romantic', 30, { rng: mulberry32(1) }); expect(m.seconds).toBeGreaterThanOrEqual(30 * 60); expect(m.seconds).toBeLessThan(30 * 60 + 300); expect(m.matched).toBeGreaterThan(5); expect(new Set(m.tracks.map(t => t.id)).size).toBe(m.tracks.length);
    for (let i = 1; i < Math.min(m.matched, 8); i++) expect(m.tracks[i].artist).not.toBe(m.tracks[i - 1].artist);
    expect(m.tracks.slice(0, m.matched).every(t => /Pyaar/.test(t.title))).toBe(true);
  });
  it('can refuse filler so a mood only plays songs that really fit; excludes online songs', () => {
    const songs = [T(1, { title: 'Dard bhari raat' }), T(2, { title: 'Random' }), T(3, { title: 'Dard', source: 'itunes', url: 'https://x' })]; const m = buildMoodMix(songs, 'sad', 30, { allowFiller: false, rng: mulberry32(2) }); expect(m.tracks.map(t => t.id)).toEqual(['lo-1']);
  });
});

describe('audio library (stories, podcasts, sleep) from files on the device', () => {
  it('suggests categories from names/folders; specific beats generic', () => {
    expect(suggestCategory({ title: 'Ghost story night', artist: '', album: 'Bhoot Kahaniya' })).toBe('story:horror'); expect(suggestCategory({ title: 'Heavy rain on roof', artist: '' })).toBe('sleep:rain'); expect(suggestCategory({ title: 'Episode 12 - Interview', artist: '', album: 'The Show Podcast' })).toBe('podcast');
    expect(suggestCategory({ title: 'Guided meditation 20 min', artist: '' })).toBe('sleep:guided'); expect(suggestCategory({ title: 'Tum Hi Ho', artist: 'Arijit Singh' })).toBeNull(); expect(suggestCategory({ title: 'Kahani', artist: '', folder: '/Audiobooks' })).toBe('story:short');
  });
  it('items link to device files; missing files are flagged, not hidden', () => {
    const items = addItem(addItem([], 'lo-1', 'sleep:rain'), 'lo-2', 'podcast'); const r = resolveItems(items, [T(1)]); expect(r.map(x => x.missing)).toEqual([false, true]); expect(byKind(r, 'sleep').length).toBe(1);
    expect(addItem(items, 'lo-1', 'sleep:ocean')[0].category).toBe('sleep:ocean'); expect(addItem(items, 'lo-1', 'sleep:ocean').length).toBe(2);   // re-categorise, no duplicate
  });
  it('episodes sort naturally (Episode 2 before Episode 10)', () => { expect(['Ep 10', 'Ep 2', 'Ep 1'].map(title => T(1, { title })).sort(episodeOrder).map(t => t.title)).toEqual(['Ep 1', 'Ep 2', 'Ep 10']); });
});

describe('journey memories (all local)', () => {
  it('collects entries per journey, newest first; favourite songs feed the journey playlist; empty entries are detectable', () => {
    const a = newMemory({ journey: 'flight-1', title: 'Take-off', song: { id: 'lo-1', title: 'x', artist: 'y' } }, 1000), b = newMemory({ journey: 'flight-1', text: 'Landed', song: { id: 'lo-1', title: 'x', artist: 'y' } }, 2000), c = newMemory({ journey: 'train-1', title: 'Other' }, 3000);
    expect(forJourney([a, b, c], 'flight-1').map(m => m.created_at)).toEqual([2000, 1000]); expect(memorySongIds([a, b, c], 'flight-1')).toEqual(['lo-1']); expect(isEmpty(newMemory({ journey: 'x' }))).toBe(true); expect(isEmpty(a)).toBe(false);
  });
});
