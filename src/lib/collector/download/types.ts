export type JobState = 'queued' | 'downloading' | 'paused' | 'waiting_wifi' | 'verifying' | 'done' | 'failed' | 'cancelled';
export type DownloadJob = {
  id: string;                       // = imported track id
  candidate_key: string; source: string; license?: string;
  url: string; ext: string; title: string; artist: string; album: string; art: string; duration_ms: number;
  expected_bytes?: number;
  state: JobState; bytes: number; total: number; attempts: number; error?: string;
  created_at: number; updated_at: number;
  result?: { id: string; url: string; size: number; folder?: string };
};
export type Settings = { wifiOnly: boolean; maxStorageMB: number; auto: boolean };
export type TransportResult = { id: string; url: string; size: number; folder?: string };
export type TransportKind = 'network' | 'http' | 'integrity' | 'storage' | 'wifi' | 'cancelled' | 'unsupported';
export class TransportError extends Error { constructor(msg: string, public kind: TransportKind, public status?: number) { super(msg); this.name = 'TransportError'; } }

export interface Transport {
  supported(): boolean;
  /** Download (or resume) one file. Must honour `signal`; when `keepPartial()` is true after an abort, keep partial data for resume. */
  download(job: DownloadJob, h: { onProgress: (bytes: number, total: number) => void; signal: AbortSignal; keepPartial: () => boolean }): Promise<TransportResult>;
  discard(jobId: string): Promise<void>;
  freeBytes(): Promise<number | null>;
  isUnmetered(): Promise<boolean | null>;
}
