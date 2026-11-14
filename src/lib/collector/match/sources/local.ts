import type { Track } from '../../../types';
import type { Candidate, MatchQuery, MatchSource } from '../types';
import { baseTitle, levRatio } from '../normalize';

/** Songs already on this device. No network, no consent needed, nothing to download. */
export class LocalSource implements MatchSource {
  id = 'local' as const; name = 'This device';
  constructor(private d: { tracks: () => Track[] }) {}
  async search(q: MatchQuery): Promise<Candidate[]> {
    const want = baseTitle(q.title); if (!want) return [];
    return this.d.tracks().filter(t => t.source === 'local' && t.url && levRatio(baseTitle(t.title), want) >= 0.7).slice(0, 8).map(t => ({
      key: `local:${t.id}`, source: 'local', source_id: t.id, title: t.title, artist: t.artist, album: t.album ?? '', duration_ms: Math.round((t.duration ?? 0) * 1000), artwork_url: t.art, page_url: '',
      quality: { label: 'Your file', lossless: /\.(flac|wav)$/i.test(t.url) }, full_length: true,
      download: { permitted: true, verified: true, local: true, reason: 'Already stored on this device' },
    }) satisfies Candidate);
  }
}
