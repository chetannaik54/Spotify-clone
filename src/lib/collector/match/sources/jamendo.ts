import type { Candidate, MatchQuery, MatchSource } from '../types';

type JamTrack = { id: string | number; name: string; duration: number; artist_name: string; album_name?: string; image?: string; album_image?: string; shareurl?: string; audio?: string; audiodownload?: string; audiodownload_allowed?: boolean; license_ccurl?: string };

/** Jamendo: independent artists, CC-licensed. Download is allowed ONLY when the recording says `audiodownload_allowed` AND gives a download URL. */
export class JamendoSource implements MatchSource {
  id = 'jamendo' as const; name = 'Jamendo';
  constructor(private d: { fetch: typeof fetch; clientId: string }) {}
  async search(q: MatchQuery, signal?: AbortSignal): Promise<Candidate[]> {
    const base = (extra: Record<string, string>) => `https://api.jamendo.com/v3.0/tracks/?${new URLSearchParams({ client_id: this.d.clientId, format: 'json', limit: '10', include: 'musicinfo', audiodlformat: 'mp32', imagesize: '300', ...extra })}`;
    const get = async (extra: Record<string, string>) => {
      const r = await this.d.fetch(base(extra), { signal }); if (!r.ok) throw new Error(`Jamendo HTTP ${r.status}`);
      const j = await r.json() as { headers?: { status?: string; error_message?: string }; results?: JamTrack[] };
      if (j.headers?.status && j.headers.status !== 'success') throw new Error(`Jamendo: ${j.headers.error_message ?? j.headers.status}`);
      return j.results ?? [];
    };
    let res = await get({ namesearch: q.title, ...(q.artist ? { artist_name: q.artist.split(/[,;&]/)[0].trim() } : {}) });
    if (!res.length) res = await get({ search: `${q.title} ${q.artist}`.trim() });
    return res.map(t => {
      const allowed = t.audiodownload_allowed === true && !!t.audiodownload;
      return {
        key: `jamendo:${t.id}`, source: 'jamendo', source_id: String(t.id), title: t.name, artist: t.artist_name, album: t.album_name ?? '', duration_ms: Math.round((t.duration ?? 0) * 1000),
        artwork_url: t.image || t.album_image || '', page_url: t.shareurl ?? `https://www.jamendo.com/track/${t.id}`, quality: { label: 'MP3 VBR (~220 kbps)', lossless: false, kbps: 220 }, full_length: (t.duration ?? 0) > 30,
        download: allowed
          ? { permitted: true, verified: true, reason: `Jamendo marks this recording as downloadable${t.license_ccurl ? ` (license: ${t.license_ccurl})` : ''}`, license: t.license_ccurl, url: t.audiodownload, format: 'mp3' }
          : { permitted: false, verified: true, reason: t.audiodownload_allowed === false ? 'The artist has disabled downloads for this recording' : 'Jamendo gives no download permission for this recording' },
      } satisfies Candidate;
    });
  }
}
