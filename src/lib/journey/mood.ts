import type { Track } from '../types';

export type Mood = 'happy' | 'romantic' | 'sad' | 'energetic' | 'motivational' | 'relaxing' | 'nostalgic';
export const MOODS: { id: Mood; label: string; emoji: string }[] = [
  { id: 'happy', label: 'Happy', emoji: '😊' }, { id: 'romantic', label: 'Romantic', emoji: '💞' }, { id: 'sad', label: 'Sad', emoji: '🌧️' }, { id: 'energetic', label: 'Energetic', emoji: '⚡' },
  { id: 'motivational', label: 'Motivational', emoji: '🔥' }, { id: 'relaxing', label: 'Relaxing', emoji: '🌿' }, { id: 'nostalgic', label: 'Nostalgic', emoji: '📻' },
];

// Keyword evidence (English + Hindi/Urdu transliterations). This is text/tag based — NOT audio analysis — and the UI says so.
const WORDS: Record<Mood, RegExp> = {
  happy: /\b(khush|khushi|happy|masti|mast|dil\s*dhadakne|jashn|celebrat|smile|muskura|badhai|bijli|gallan|chaiyya|nachde|jhoom|zindagi na milegi)\b/i,
  romantic: /\b(pyaar|pyar|ishq|ishqa|mohabbat|love|dil|tum hi|tumhi|tere bina|sanam|saathiya|humsafar|raabta|kesariya|jaanam|janam|sajna|piya|mehboob|rang|kiss|valentine|dilbar)\b/i,
  sad: /\b(dard|judai|judaai|bewafa|tanha|akela|aansu|alvida|bichhad|tadap|dukh|rona|rula|tut|toota|broken|cry|tears|lonely|alone|yaad|kabhi alvida|channa mereya|gham)\b/i,
  energetic: /\b(party|dance|nachle|nach|dhoom|badtameez|dj|remix|beat|bass|thumka|kala chashma|saturday|jalwa|disco|tamma|chammak|abhi toh|balam pichkari|lungi)\b/i,
  motivational: /\b(chak de|lakshya|zindagi|jeet|sapne|sapna|fight|rise|believe|champion|winner|hausla|himmat|manzil|dream|never give|roar|kar har maidan|jai ho|ziddi)\b/i,
  relaxing: /\b(sukoon|chaand|chand|raat|neend|lori|sleep|calm|relax|soft|unplugged|acoustic|instrumental|ambient|piano|sufi|ghazal|ocean|rain|meditat|slow|dhun)\b/i,
  nostalgic: /\b(yaadein|yaad|purane|old|retro|classic|vintage|golden|bachpan|kabhi kabhi|kal ho naa ho|dil to pagal)\b/i,
};
const GENRE: Record<Mood, RegExp> = { happy: /pop|dance|folk|bhangra/i, romantic: /romantic|love|ballad/i, sad: /sad|ghazal|emotional|melanch/i, energetic: /dance|edm|electronic|party|hip.?hop|rap|rock|punjabi|bhangra/i, motivational: /motiv|inspir|anthem|hip.?hop|rap/i, relaxing: /sufi|ambient|classical|instrumental|chill|lounge|lo.?fi|acoustic|devotional|ghazal|new age/i, nostalgic: /retro|classic|old|golden|vintage|oldies/i };

export type MoodScore = { score: number; why: string[] };
export function moodScore(t: Track, mood: Mood, feedback?: Record<string, 1 | -1>, liked = false, nowYear = new Date().getFullYear()): MoodScore {
  const why: string[] = []; let s = 0; const hay = `${t.title} ${t.album ?? ''} ${t.artist}`;
  if (WORDS[mood].test(hay)) { s += 3; why.push('title/album words'); }
  if (t.genre && GENRE[mood].test(t.genre)) { s += 3; why.push(`genre “${t.genre}”`); }
  const y = t.year ?? 0;
  if (mood === 'nostalgic' && y >= 1950) { const age = nowYear - y; if (age >= 20) { s += 3; why.push(`${y} release`); } else if (age >= 12) { s += 1.5; why.push(`${y} release`); } }
  if (mood === 'energetic' && t.duration && t.duration < 215) { s += 0.5; }
  if (mood === 'relaxing' && t.duration && t.duration > 300) { s += 0.5; }
  if (feedback && feedback[mood] === 1) { s += 6; why.push('you said it fits'); }
  if (feedback && feedback[mood] === -1) { s -= 8; why.push('you said it does not fit'); }
  if (liked) { s += 0.5; why.push('liked'); }
  return { score: s, why };
}

export type MoodMix = { tracks: Track[]; seconds: number; matched: number; filler: number };
/** Build a mix for a mood and duration from the local library. Mood evidence first; fills with liked/other songs only if needed; no artist twice in a row. */
export function buildMoodMix(local: Track[], mood: Mood, minutes: number, o: { feedback?: Record<string, Record<string, 1 | -1>>; likedIds?: Set<string>; recentIds?: Set<string>; rng?: () => number; allowFiller?: boolean } = {}): MoodMix {
  const rng = o.rng ?? Math.random; const pool = local.filter(t => t.source === 'local' && t.url);
  const scored = pool.map(t => ({ t, ...moodScore(t, mood, o.feedback?.[t.id], o.likedIds?.has(t.id)), jitter: rng() * 0.9 - (o.recentIds?.has(t.id) ? 1.5 : 0) }));
  const matched = scored.filter(x => x.score >= 2.5).sort((a, b) => b.score + b.jitter - (a.score + a.jitter));
  const filler = (o.allowFiller ?? true) ? scored.filter(x => x.score > -4 && x.score < 2.5).sort((a, b) => b.score + b.jitter - (a.score + a.jitter)) : [];
  const target = minutes * 60; const out: Track[] = []; let seconds = 0, nMatched = 0, nFill = 0; const rest = [...matched.map(x => ({ ...x, m: true })), ...filler.map(x => ({ ...x, m: false }))];
  while (seconds < target && rest.length) {
    const lastArtist = out.length ? out[out.length - 1].artist : ''; let i = rest.findIndex(x => !lastArtist || x.t.artist !== lastArtist || !x.t.artist); if (i < 0) i = 0;
    const [x] = rest.splice(i, 1); out.push(x.t); seconds += x.t.duration ?? 210; x.m ? nMatched++ : nFill++;
  }
  return { tracks: out, seconds, matched: nMatched, filler: nFill };
}
