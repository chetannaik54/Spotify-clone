import type { Track } from './types';

const j = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

/** iTunes Search API – no key, Bollywood metadata + artwork, 30s previews. */
export async function searchItunes(q: string, limit = 25): Promise<Track[]> {
  const d = await j(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&country=IN&media=music&entity=song&limit=${limit}`);
  return (d.results as any[]).filter(x => x.previewUrl).map(x => ({
    id: `it-${x.trackId}`, title: x.trackName, artist: x.artistName, album: x.collectionName,
    art: String(x.artworkUrl100).replace('100x100', '600x600'), url: x.previewUrl,
    duration: Math.round((x.trackTimeMillis ?? 30000) / 1000), source: 'itunes' as const, preview: true,
  }));
}

/** Jamendo – legal full-length tracks. Needs a free client_id (developer.jamendo.com). */
export async function searchJamendo(q: string, clientId: string, limit = 25): Promise<Track[]> {
  if (!clientId) return [];
  const d = await j(`https://api.jamendo.com/v3.0/tracks/?client_id=${clientId}&format=json&limit=${limit}&search=${encodeURIComponent(q)}&include=musicinfo&audioformat=mp32&imagesize=500`);
  return (d.results as any[]).map(x => ({
    id: `ja-${x.id}`, title: x.name, artist: x.artist_name, album: x.album_name,
    art: x.image || x.album_image, url: x.audio, duration: x.duration, source: 'jamendo' as const,
  }));
}

/** Internet Archive – full-length, freely hosted audio (public-domain / uploader-licensed). */
export async function searchArchive(q: string, limit = 25): Promise<Track[]> {
  const query = `(${q}) AND mediatype:audio`;
  const d = await j(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&rows=${limit}&output=json`);
  const docs = d.response.docs as any[];
  const out = await Promise.all(docs.slice(0, 10).map(async doc => {
    try {
      const m = await j(`https://archive.org/metadata/${doc.identifier}`);
      const f = (m.files as any[]).find(f => /\.mp3$/i.test(f.name));
      if (!f) return null;
      return {
        id: `ar-${doc.identifier}`, title: doc.title, artist: Array.isArray(doc.creator) ? doc.creator[0] : doc.creator || 'Unknown',
        art: `https://archive.org/services/img/${doc.identifier}`,
        url: `https://archive.org/download/${doc.identifier}/${encodeURIComponent(f.name)}`,
        duration: Math.round(Number(f.length) || 0), source: 'archive' as const,
      } as Track;
    } catch { return null; }
  }));
  return out.filter(Boolean) as Track[];
}

export async function searchAll(q: string, jamendoId: string): Promise<Track[]> {
  const r = await Promise.allSettled([searchJamendo(q, jamendoId), searchArchive(q, 10), searchItunes(q)]);
  return r.flatMap(x => (x.status === 'fulfilled' ? x.value : []));
}

/** Curated Bollywood shelves for the Home screen. */
export const SHELVES: { title: string; q: string; emoji: string }[] = [
  { title: 'Arijit Singh – Romantic Hits', q: 'Arijit Singh', emoji: '💜' },
  { title: 'Retro Gold: Kishore & Rafi', q: 'Kishore Kumar', emoji: '📻' },
  { title: 'Lata & Asha Classics', q: 'Lata Mangeshkar', emoji: '🌹' },
  { title: 'A. R. Rahman Magic', q: 'A. R. Rahman', emoji: '🎼' },
  { title: 'Party Anthems', q: 'Badshah Bollywood party', emoji: '🔥' },
  { title: 'Sufi & Soul', q: 'Sufi Bollywood Nusrat Rahat Fateh Ali Khan', emoji: '🕌' },
  { title: 'Shreya Ghoshal', q: 'Shreya Ghoshal', emoji: '🎤' },
  { title: 'Latest Bollywood', q: 'Bollywood 2025', emoji: '🆕' },
];

/** Synced lyrics from LRCLIB (free, no key). */
export async function fetchLyrics(t: Track): Promise<string | null> {
  try {
    const d = await j(`https://lrclib.net/api/get?track_name=${encodeURIComponent(t.title)}&artist_name=${encodeURIComponent(t.artist)}`);
    return d.syncedLyrics || d.plainLyrics || null;
  } catch { return null; }
}
