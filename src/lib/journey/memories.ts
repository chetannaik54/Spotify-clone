export type Memory = { id: string; title: string; text: string; photoIds: string[]; voiceIds: string[]; song: { id: string; title: string; artist: string } | null; journey: string; created_at: number };
export const photoKey = (id: string) => `mem-photo:${id}`;
export const voiceKey = (id: string) => `mem-voice:${id}`;

export const newMemory = (o: Partial<Memory> & { journey: string }, now = Date.now()): Memory => ({ id: `mem-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, title: '', text: '', photoIds: [], voiceIds: [], song: null, created_at: now, ...o });
export const isEmpty = (m: Memory) => !m.title.trim() && !m.text.trim() && !m.photoIds.length && !m.voiceIds.length && !m.song;
export const forJourney = (all: Memory[], journey: string) => all.filter(m => m.journey === journey).sort((a, b) => b.created_at - a.created_at);
/** Songs saved as favourites in this journey's memories (deduped) — used to build the journey playlist. */
export const memorySongIds = (all: Memory[], journey: string) => [...new Set(forJourney(all, journey).map(m => m.song?.id).filter((x): x is string => !!x))];

/** Downscale a photo to ≤1600 px JPEG so memories stay small. */
export async function compressImage(file: Blob, max = 1600, quality = 0.85): Promise<Blob> {
  const bmp = await createImageBitmap(file); const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not process the photo'))), 'image/jpeg', quality));
}

/** Private voice note recorder (microphone permission is asked by Android; audio never leaves the device). */
export class VoiceRecorder {
  private rec: MediaRecorder | null = null; private chunks: Blob[] = []; private stream: MediaStream | null = null; startedAt = 0;
  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This device does not allow recording here');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); this.chunks = [];
    this.rec = new MediaRecorder(this.stream); this.rec.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); }; this.rec.start(); this.startedAt = Date.now();
  }
  stop(): Promise<{ blob: Blob; ms: number }> {
    return new Promise((res, rej) => { if (!this.rec) return rej(new Error('Not recording')); const r = this.rec; r.onstop = () => { this.stream?.getTracks().forEach(t => t.stop()); res({ blob: new Blob(this.chunks, { type: r.mimeType || 'audio/webm' }), ms: Date.now() - this.startedAt }); }; r.stop(); });
  }
}
