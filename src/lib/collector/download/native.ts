import { Capacitor, registerPlugin } from '@capacitor/core';
import { TransportError, type DownloadJob, type Transport } from './types';

type Plugin = {
  download(o: { id: string; url: string; title: string; artist: string; album: string; ext: string; expectedBytes?: number; wifiOnly: boolean }): Promise<{ id: string; uri: string; size: number; folder: string }>;
  cancel(o: { id: string; keepPartial: boolean }): Promise<void>;
  discard(o: { id: string }): Promise<void>;
  storage(): Promise<{ freeBytes: number }>;
  network(): Promise<{ unmetered: boolean }>;
  addListener(ev: 'progress', fn: (e: { id: string; bytes: number; total: number }) => void): Promise<{ remove(): Promise<void> }>;
};
const Native = registerPlugin<Plugin>('Downloader');
export const hasNativeDownloader = Capacitor.isNativePlatform();

/** Android transport: the Downloader plugin writes straight into MediaStore (Music/Swarify/<Artist>/<Album>/), resumable. */
export class NativeTransport implements Transport {
  private progress = new Map<string, (b: number, t: number) => void>(); private sub: Promise<{ remove(): Promise<void> }> | null = null;
  supported() { return hasNativeDownloader; }
  private listen() { this.sub ??= Native.addListener('progress', e => this.progress.get(e.id)?.(e.bytes, e.total)); }
  freeBytes = async () => { try { return (await Native.storage()).freeBytes; } catch { return null; } };
  isUnmetered = async () => { try { return (await Native.network()).unmetered; } catch { return null; } };
  discard = async (id: string) => { await Native.discard({ id }); };
  async download(job: DownloadJob, h: Parameters<Transport['download']>[1]) {
    this.listen(); this.progress.set(job.id, h.onProgress);
    const onAbort = () => { Native.cancel({ id: job.id, keepPartial: h.keepPartial() }).catch(() => {}); }; h.signal.addEventListener('abort', onAbort, { once: true });
    try {
      const r = await Native.download({ id: job.id, url: job.url, title: job.title, artist: job.artist, album: job.album, ext: job.ext, expectedBytes: job.expected_bytes, wifiOnly: false });
      return { id: `lo-ms-${r.id}`, url: r.uri, size: r.size, folder: r.folder };
    } catch (e) {
      const m = String((e as { message?: string }).message ?? e); const code = (e as { code?: string }).code ?? '';
      if (h.signal.aborted || code === 'CANCELLED') throw new TransportError('Cancelled', 'cancelled');
      if (code === 'INTEGRITY') throw new TransportError(m, 'integrity');
      if (code === 'STORAGE') throw new TransportError(m, 'storage');
      if (code === 'HTTP') throw new TransportError(m, 'http', Number(/HTTP (\d+)/.exec(m)?.[1]));
      throw new TransportError(m, 'network');
    } finally { this.progress.delete(job.id); h.signal.removeEventListener('abort', onAbort); }
  }
}
