import type { IncomingTrack } from './catalogue';

/** RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], f = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
    else f += c;
  }
  row.push(f); if (row.some(x => x !== '')) rows.push(row);
  return rows;
}

const ALIAS: Record<string, string[]> = {
  title: ['track name', 'track', 'title', 'song', 'song name', 'name'],
  artist: ['artist name(s)', 'artist names', 'artist name', 'artists', 'artist'],
  album: ['album name', 'album', 'movie'],
  duration: ['duration (ms)', 'duration_ms', 'duration ms', 'duration'],
  uri: ['track uri', 'spotify uri', 'uri', 'spotify id', 'track id', 'isrc'],
  image: ['album image url', 'image url', 'artwork', 'cover'],
  added: ['added at', 'date added', 'added'],
};
const idx = (h: string[], k: string) => { for (const a of ALIAS[k]) { const i = h.indexOf(a); if (i >= 0) return i; } return -1; };
const hash = (s: string) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36); };
const spotifyId = (u: string) => u.match(/spotify:track:([A-Za-z0-9]{22})/)?.[1] ?? u.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([A-Za-z0-9]{22})/)?.[1] ?? null;
const durMs = (v: string) => { if (!v) return 0; if (/^\d+$/.test(v)) { const n = +v; return n < 20000 ? n * 1000 : n; } const m = v.match(/^(\d+):(\d{2})$/); return m ? (+m[1] * 60 + +m[2]) * 1000 : 0; };

export type CsvResult = { playlistName: string; items: IncomingTrack[]; skipped: number; error?: string };

/** Turn an exported playlist CSV (e.g. from Exportify) into catalogue rows. Spotify track URIs dedupe against API imports. */
export function parseCsvPlaylist(fileName: string, text: string): CsvResult {
  const name = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Imported playlist';
  const rows = parseCsv(text); if (rows.length < 2) return { playlistName: name, items: [], skipped: 0, error: 'The file has no rows' };
  const h = rows[0].map(x => x.trim().toLowerCase());
  const ti = idx(h, 'title'); if (ti < 0) return { playlistName: name, items: [], skipped: rows.length - 1, error: 'No song-title column found (expected “Track Name”, “Title” or “Song”)' };
  const ai = idx(h, 'artist'), bi = idx(h, 'album'), di = idx(h, 'duration'), ui = idx(h, 'uri'), ii = idx(h, 'image'), ad = idx(h, 'added');
  const items: IncomingTrack[] = []; let skipped = 0;
  for (const r of rows.slice(1)) {
    const title = (r[ti] ?? '').trim(); if (!title) { skipped++; continue; }
    const artist = (ai >= 0 ? r[ai] ?? '' : '').split(/[;]+/).map(x => x.trim()).filter(Boolean).join(', ');
    const album = bi >= 0 ? (r[bi] ?? '').trim() : '';
    const sid = ui >= 0 ? spotifyId(r[ui] ?? '') : null;
    items.push({ platform: sid ? 'spotify' : 'csv', source_track_id: sid ?? `csv-${hash(`${title}|${artist}|${album}`.toLowerCase())}`, song_title: title, artist_name: artist, album_name: album,
      artwork_url: ii >= 0 ? (r[ii] ?? '').trim() : '', duration_ms: di >= 0 ? durMs((r[di] ?? '').trim()) : 0, source_url: sid ? `https://open.spotify.com/track/${sid}` : '', import_status: 'imported', added_at: ad >= 0 ? (r[ad] ?? '') || null : null });
  }
  return { playlistName: name, items, skipped };
}
