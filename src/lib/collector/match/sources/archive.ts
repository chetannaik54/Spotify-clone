import type { Candidate, MatchQuery, MatchSource } from '../types';
import { titleSimilarity } from '../normalize';
import { fetchWithRetry } from './httpRetry';

type Doc = { identifier: string; title?: string | string[]; creator?: string | string[]; licenseurl?: string };
type IaFile = { name: string; format?: string; size?: string; length?: string; bitrate?: string; source?: string };
const first = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v) ?? '';
const AUDIO_PREF = ['Flac', 'VBR MP3', '256Kbps MP3', '192Kbps MP3', 'MP3', '128Kbps MP3', 'Ogg Vorbis'];
const OPEN_LICENSE = /creativecommons\.org\/(licenses|publicdomain)\/|creativecommons\.org\/share-your-work\/public-domain|publicdomain/i;

/**
 * Internet Archive. A file being publicly reachable is NOT permission. A download is allowed only when the item has an explicit
 * open license (Creative Commons / public domain) in its metadata, is not access-restricted or "dark", and has an audio file.
 */
export class ArchiveSource implements MatchSource {
  id = 'archive' as const; name = 'Internet Archive';
  constructor(private d: { fetch: typeof fetch; maxItems?: number }) {}
  private get(url: string, signal?: AbortSignal): Promise<Response> { return fetchWithRetry(this.d.fetch, url, { signal }); }
  async search(q: MatchQuery, signal?: AbortSignal): Promise<Candidate[]> {
    const esc = (s: string) => s.replace(/["\\()\[\]:^~*?]/g, ' ').replace(/\s+/g, ' ').trim();
    const artist = esc(q.artist.split(/[,;&]/)[0] ?? '');
    const query = `title:(${esc(q.title)})${artist ? ` AND creator:(${artist})` : ''} AND mediatype:audio`;
    const url = `https://archive.org/advancedsearch.php?${new URLSearchParams({ q: query, rows: '8', output: 'json' })}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl`;
    const r = await this.get(url, signal); if (!r.ok) throw new Error(`Internet Archive HTTP ${r.status}`);
    const docs = ((await r.json()) as { response?: { docs?: Doc[] } }).response?.docs ?? [];
    const out: Candidate[] = [];
    // only look closer at hits whose title plausibly matches (saves a metadata request per irrelevant hit)
    const plausible = docs.filter(d => !first(d.title) || titleSimilarity(q.title, first(d.title)) >= 0.6);   // no title = can't judge, keep it
    for (const doc of plausible.slice(0, this.d.maxItems ?? 4)) {
      try {
        const mr = await this.get(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`, signal); if (!mr.ok) continue;
        const m = await mr.json() as { files?: IaFile[]; metadata?: Record<string, unknown>; is_dark?: boolean };
        const md = m.metadata ?? {}; const files = (m.files ?? []).filter(f => /mp3|flac|ogg/i.test(f.format ?? ''));
        const pick = AUDIO_PREF.map(p => files.find(f => f.format === p)).find(Boolean) ?? files[0];
        const license = String(md.licenseurl ?? doc.licenseurl ?? ''); const restricted = String(md['access-restricted-item'] ?? '').toLowerCase() === 'true' || !!m.is_dark;
        const dur = pick?.length ? (pick.length.includes(':') ? pick.length.split(':').reduce((a, x) => a * 60 + +x, 0) : parseFloat(pick.length)) : 0;
        let download: Candidate['download'];
        if (!pick) download = { permitted: false, verified: true, reason: 'No audio file in this item' };
        else if (restricted) download = { permitted: false, verified: true, reason: 'Access-restricted item (borrow/stream only)' };
        else if (!OPEN_LICENSE.test(license)) download = { permitted: false, verified: true, reason: 'No explicit open license (Creative Commons / public domain) in the item metadata' };
        else download = { permitted: true, verified: true, reason: `Open license: ${license}`, license, url: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(pick.name)}`, format: (pick.format ?? '').toLowerCase().includes('flac') ? 'flac' : 'mp3', bytes: pick.size ? +pick.size : undefined };
        out.push({ key: `archive:${doc.identifier}`, source: 'archive', source_id: doc.identifier, title: String(md.title ?? first(doc.title)), artist: String(md.creator ?? first(doc.creator)), album: '',
          duration_ms: Math.round(dur * 1000), artwork_url: `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`, page_url: `https://archive.org/details/${encodeURIComponent(doc.identifier)}`,
          quality: { label: pick?.format ?? 'unknown', lossless: /flac/i.test(pick?.format ?? ''), kbps: pick?.bitrate ? +pick.bitrate : undefined }, full_length: dur > 30, download });
      } catch (e) { if ((e as Error).name === 'AbortError') throw e; /* skip one broken item */ }
    }
    return out;
  }
}
