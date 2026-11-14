import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Track } from './types';
import { putFile } from './db';
import { set } from './store';

type Raw = { id: number; title: string; artist: string; album: string; albumId: number; duration: number; uri: string; folder: string; size?: number; year?: number; genre?: string };
const MediaScan = registerPlugin<{ scan(): Promise<{ tracks: Raw[] }> }>('MediaScan');
export const isNative = Capacitor.isNativePlatform();

/** Convert a content:// URI into a URL the WebView's <audio>/<img> can load (served by Capacitor's local server). */
export function resolveSrc(u: string): string {
  if (u.startsWith('content://')) return `${location.origin}/_capacitor_content_${u.slice('content:/'.length)}`;
  return u;
}

function merge(tracks: Track[]) {
  set(s => {
    const ids = new Set(tracks.map(t => t.id));
    // keep previously imported browser files, replace anything the scan re-found
    return { local: [...tracks, ...s.local.filter(t => !ids.has(t.id) && t.url.startsWith('local:'))] };
  });
}

/** Native: scan the whole device (all folders) via MediaStore. */
export async function scanDevice(): Promise<number> {
  const { tracks } = await MediaScan.scan();
  const mapped: Track[] = tracks.map(r => ({
    id: `lo-ms-${r.id}`, title: r.title || 'Unknown', artist: r.artist, album: r.album, duration: r.duration,
    art: `content://media/external/audio/albumart/${r.albumId}`, url: r.uri, source: 'local', folder: r.folder || 'Other',
    size: r.size || undefined, year: r.year || undefined, genre: r.genre || undefined,
  }));
  merge(mapped);
  return mapped.length;
}

/** Browser/tablet fallback: import many files at once (a whole folder via webkitdirectory, or multi-select). */
export async function importFiles(files: FileList | File[]): Promise<number> {
  const added: Track[] = [];
  for (const f of Array.from(files)) {
    if (!/^audio\//.test(f.type) && !/\.(mp3|m4a|aac|flac|wav|ogg|opus|wma)$/i.test(f.name)) continue;
    const id = crypto.randomUUID(); await putFile(id, f);
    const base = f.name.replace(/\.[^.]+$/, ''); const m = base.split(' - ');
    const rel = (f as any).webkitRelativePath as string | undefined;
    added.push({ id: `lo-${id}`, title: (m.length > 1 ? m.slice(1).join(' - ') : base).trim(), artist: m.length > 1 ? m[0].trim() : 'My Music',
      art: '', url: `local:${id}`, source: 'local', size: f.size, folder: rel ? rel.split('/').slice(0, -1).join('/') || 'Imported' : 'Imported' });
  }
  set(s => ({ local: [...added, ...s.local] }));
  return added.length;
}
