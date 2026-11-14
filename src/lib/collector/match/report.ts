import type { ImportedPlaylist, ImportedTrack } from '../types';
import { displayName } from '../playlistNames';
import type { MatchRecord } from './types';

/** Tracks in their ORIGINAL playlist order (playlist by playlist, each song once). Optionally restricted to one playlist. */
export function orderedTracks(playlists: ImportedPlaylist[], tracks: ImportedTrack[], playlistId?: string): { track: ImportedTrack; playlist: ImportedPlaylist; position: number }[] {
  const byId = new Map(tracks.map(t => [t.id, t])); const seen = new Set<string>(); const out: { track: ImportedTrack; playlist: ImportedPlaylist; position: number }[] = [];
  for (const p of playlists) {
    if (playlistId && p.id !== playlistId) continue;
    for (const e of [...p.entries].filter(e => !e.removed_at).sort((a, b) => a.position - b.position)) {
      const t = byId.get(e.track_id); if (!t || (!playlistId && seen.has(t.id))) continue; seen.add(t.id); out.push({ track: t, playlist: p, position: e.position + 1 });
    }
  }
  return out;
}

export type Summary = { total: number; exact: number; possible: number; review: number; unavailable: number; downloadable: number; onDevice: number; unsearched: number };
export const eligible = (c: MatchRecord['candidates'][number]) => c.download.permitted && !c.download.local && c.band !== 'review' && !c.flags.some(f => /^Different|Preview/.test(f));

export function summarise(tracks: ImportedTrack[], matches: MatchRecord[]): Summary {
  const rec = new Map(matches.map(m => [m.track_id, m])); const s: Summary = { total: 0, exact: 0, possible: 0, review: 0, unavailable: 0, downloadable: 0, onDevice: 0, unsearched: 0 };
  for (const t of tracks) {
    if (t.import_status !== 'imported') continue; s.total++;
    const r = rec.get(t.id); const best = r?.candidates[0]; const sel = r?.candidates.find(c => c.key === r.selected);
    if (t.matching_status === 'downloaded') s.onDevice++;
    if (!r) { s.unsearched++; continue; }
    if (best?.band === 'exact') s.exact++; else if (best?.band === 'likely') s.possible++; else if (best?.band === 'review') s.review++;
    if (!best || t.matching_status === 'no_match' || t.matching_status === 'failed' || t.matching_status === 'unavailable') s.unavailable++;
    if (sel ? sel.download.permitted && !sel.download.local : r.candidates.some(eligible)) s.downloadable++;
  }
  return s;
}

const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
/** CSV text of the real matching outcome, for the user to paste/share. */
export function buildReport(rows: ReturnType<typeof orderedTracks>, matches: MatchRecord[]): string {
  const rec = new Map(matches.map(m => [m.track_id, m]));
  const head = ['#', 'Playlist', 'Song', 'Artist', 'Album', 'Status', 'Confidence', 'Best match', 'Match artist', 'Source', 'Download permitted', 'Reason', 'Flags', 'Errors'];
  const lines = rows.map(({ track: t, playlist: p, position }) => {
    const r = rec.get(t.id); const c = r?.candidates.find(x => x.key === r.selected) ?? r?.candidates[0];
    return [position, displayName(p), t.song_title, t.artist_name, t.album_name, t.matching_status, c ? c.confidence : '', c?.title ?? '', c?.artist ?? '', c?.source ?? '', c ? (c.download.local ? 'on device' : c.download.permitted ? 'yes' : 'no') : '', c?.download.reason ?? '', c?.flags.join('; ') ?? '', r?.errors.map(e => `${e.source}: ${e.message}`).join('; ') ?? ''].map(v => q(String(v))).join(',');
  });
  return [head.join(','), ...lines].join('\n');
}
