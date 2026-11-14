import type { MatchingStatus } from '../types';

export type SourceId = 'local' | 'jamendo' | 'archive' | 'soundcloud';
export type Band = 'exact' | 'likely' | 'review';
export type Quality = { label: string; lossless: boolean; kbps?: number };

/** What the source itself says about downloading THIS recording. `permitted` is only ever true with explicit evidence. */
export type DownloadInfo = {
  permitted: boolean;
  verified: boolean;               // we looked at the source's rights metadata for this specific recording
  reason: string;                  // human-readable evidence or the reason it is not allowed
  license?: string;
  url?: string;                    // direct file URL (only set when permitted)
  format?: string; bytes?: number;
  local?: boolean;                 // already stored on this device
};

export type Candidate = {
  key: string;                     // `${source}:${source_id}`
  source: SourceId; source_id: string;
  title: string; artist: string; album: string;
  duration_ms: number; artwork_url: string; page_url: string;
  quality: Quality; full_length: boolean;
  download: DownloadInfo;
};

export type ScoredCandidate = Candidate & {
  confidence: number;              // 0..100
  band: Band;
  duration_diff_ms: number | null;
  flags: string[];                 // 'Different version: live', 'Different artist', 'Artist unknown', 'Duration differs'…
  parts: { title: number; artist: number | null; duration: number | null; album: number | null };
};

export type MatchRecord = {
  track_id: string;
  candidates: ScoredCandidate[];   // best first, ≥ 40 only
  selected: string | null;         // candidate key the user (or an exact match) chose
  selected_by: 'auto' | 'user' | null;
  band: Band | null;
  rejected: string[];              // candidate keys the user rejected
  errors: { source: SourceId; message: string }[];
  skipped: boolean;
  checked_at: number;
};

export type MatchQuery = { title: string; artist: string; album: string; duration_ms: number };
export interface MatchSource {
  id: SourceId; name: string;
  /** Sends only title/artist (never account or playlist data). */
  search(q: MatchQuery, signal?: AbortSignal): Promise<Candidate[]>;
}
export type { MatchingStatus };
