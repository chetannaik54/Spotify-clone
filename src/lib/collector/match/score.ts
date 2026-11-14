import { artistSimilarity, baseTitle, levRatio, splitArtists, titleSimilarity, versionTags } from './normalize';
const splitArtistsEmpty = (a: string) => splitArtists(a).length === 0;
import type { Band, Candidate, MatchQuery, ScoredCandidate } from './types';

export const EXACT = 95, LIKELY = 80, MIN_KEPT = 40;
export const bandOf = (c: number): Band => (c >= EXACT ? 'exact' : c >= LIKELY ? 'likely' : 'review');

function durationScore(diffMs: number): number { const d = Math.abs(diffMs) / 1000; return d <= 2 ? 1 : d <= 5 ? 0.9 : d <= 10 ? 0.7 : d <= 20 ? 0.4 : d <= 40 ? 0.15 : 0; }

/**
 * Confidence that `cand` is the SAME RECORDING as the imported song.
 * title 45 % · artist 30 % · duration 15 % · album 10 % (missing signals are left out, not guessed).
 * Hard rules: a different version or different artist can never reach "likely"; an unknown original artist can never reach "exact".
 */
export function scoreCandidate(q: MatchQuery, c: Candidate, sourceRawTitle = q.title): ScoredCandidate {
  const flags: string[] = [];
  const title = titleSimilarity(q.title, c.title);
  const artist = artistSimilarity(q.artist, c.artist);
  const hasDur = q.duration_ms > 0 && c.duration_ms > 0;
  const dur = hasDur ? durationScore(c.duration_ms - q.duration_ms) : null;
  const album = q.album && c.album ? Math.max(levRatio(baseTitle(q.album), baseTitle(c.album)), 0) : null;

  const w = { title: 0.45, artist: artist === null ? 0 : 0.3, duration: dur === null ? 0 : 0.15, album: album === null ? 0 : 0.1 };
  const total = w.title + w.artist + w.duration + w.album;
  let score = (title * w.title + (artist ?? 0) * w.artist + (dur ?? 0) * w.duration + (album ?? 0) * w.album) / total;
  let cap = 100;

  const srcV = versionTags(sourceRawTitle), cV = versionTags(`${c.title} ${c.album}`);
  const extra = [...cV].filter(v => !srcV.has(v)), missing = [...srcV].filter(v => !cV.has(v));
  if (extra.length) { flags.push(`Different version: ${extra.join(', ')}`); score *= 0.7; cap = Math.min(cap, 79); }
  if (missing.length) { flags.push(`Original is a ${missing.join(', ')} version`); cap = Math.min(cap, 79); }
  if (artist !== null && artist < 0.5) { flags.push('Different artist'); score *= 0.75; cap = Math.min(cap, 79); }
  if (artist === null) { flags.push(splitArtistsEmpty(q.artist) ? 'Original artist unknown — please confirm' : 'File has no artist tag — please confirm'); cap = Math.min(cap, 89); }
  if (title < 0.8) cap = Math.min(cap, 79);
  if (dur !== null && Math.abs(c.duration_ms - q.duration_ms) > 20000) { flags.push(`Duration differs by ${Math.round(Math.abs(c.duration_ms - q.duration_ms) / 1000)} s`); cap = Math.min(cap, 79); }
  if (!c.full_length) { flags.push('Preview only'); cap = Math.min(cap, 79); }

  const confidence = Math.max(0, Math.min(cap, Math.round(score * 100)));
  return { ...c, confidence, band: bandOf(confidence), duration_diff_ms: hasDur ? c.duration_ms - q.duration_ms : null, flags, parts: { title: +title.toFixed(2), artist: artist === null ? null : +artist.toFixed(2), duration: dur === null ? null : +dur.toFixed(2), album: album === null ? null : +album.toFixed(2) } };
}
