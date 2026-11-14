import type { ImportedPlaylist } from './types';

const NOISE = /\b(test|tests|fixed|final|export|exported|exportify|copy|csv|new|latest|backup|v\d+|\d{1,2}-\d{1,2}-\d{2,4})\b/gi;

/** Turn a file name like "swarify_bollywood_90s_2000s_test_fixed (1).csv" into a readable playlist name. */
export function cleanPlaylistName(raw: string): string {
  let s = raw.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/\(\d+\)|\[\d+\]/g, ' ').replace(/[_\-.]+/g, ' ').replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
  if (!s) s = raw.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_\-.]+/g, ' ').trim() || 'Imported playlist';
  return s.split(' ').map(w => (/^\d/.test(w) || w !== w.toLowerCase() ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
}

/** What the UI shows: a user rename wins; file-based names are cleaned; API playlists keep their own name. */
export const displayName = (p: Pick<ImportedPlaylist, 'name' | 'custom_name' | 'source_platform'>) => p.custom_name || (p.source_platform === 'csv' ? cleanPlaylistName(p.name) : p.name);
