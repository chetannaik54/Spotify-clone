import type { Candidate, MatchQuery, MatchSource } from '../types';

type ScTrack = { id: number; title: string; duration: number; user?: { username?: string }; artwork_url?: string | null; permalink_url?: string; downloadable?: boolean; download_url?: string | null; has_downloads_left?: boolean; access?: string; streamable?: boolean; license?: string; original_format?: string; genre?: string; label_name?: string };

/**
 * SoundCloud. Streaming is not downloading: only tracks whose artist has ENABLED downloads (`downloadable`), that are fully playable
 * (`access: playable`, not a preview/blocked) and still have downloads left are offered. Needs the user's own client id.
 */
export class SoundCloudSource implements MatchSource {
  id = 'soundcloud' as const; name = 'SoundCloud';
  constructor(private d: { fetch: typeof fetch; clientId: string }) {}
  async search(q: MatchQuery, signal?: AbortSignal): Promise<Candidate[]> {
    const url = `https://api.soundcloud.com/tracks?${new URLSearchParams({ q: `${q.title} ${q.artist}`.trim(), client_id: this.d.clientId, limit: '10', linked_partitioning: 'true' })}`;
    const r = await this.d.fetch(url, { signal });
    if (r.status === 401 || r.status === 403) throw new Error('SoundCloud rejected the client id (API access may be restricted for new apps)');
    if (!r.ok) throw new Error(`SoundCloud HTTP ${r.status}`);
    const j = await r.json() as ScTrack[] | { collection?: ScTrack[] }; const list = Array.isArray(j) ? j : j.collection ?? [];
    return list.map(t => {
      const full = (t.access ?? 'playable') === 'playable';
      let download: Candidate['download'];
      if (!t.downloadable || !t.download_url) download = { permitted: false, verified: true, reason: 'The artist has not enabled downloads on SoundCloud (streaming only)' };
      else if (!full) download = { permitted: false, verified: true, reason: `Track is ${t.access ?? 'not fully playable'} — not a full-length download` };
      else if (t.has_downloads_left === false) download = { permitted: false, verified: true, reason: 'The artist’s download limit has been reached' };
      else download = { permitted: true, verified: true, reason: `Artist-enabled download${t.license ? ` (license: ${t.license})` : ''}`, license: t.license, url: `${t.download_url}${t.download_url.includes('?') ? '&' : '?'}client_id=${encodeURIComponent(this.d.clientId)}`, format: (t.original_format ?? 'mp3').toLowerCase() };
      return { key: `soundcloud:${t.id}`, source: 'soundcloud', source_id: String(t.id), title: t.title, artist: t.user?.username ?? '', album: '', duration_ms: t.duration ?? 0, artwork_url: t.artwork_url ?? '', page_url: t.permalink_url ?? '',
        quality: { label: t.downloadable ? `Original upload (${(t.original_format ?? 'mp3').toUpperCase()})` : 'Stream only', lossless: /wav|flac|aif/i.test(t.original_format ?? ''), }, full_length: full && (t.duration ?? 0) > 30000, download } satisfies Candidate;
    });
  }
}
