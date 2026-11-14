export type Track = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  art: string;          // artwork URL (or data URL)
  url: string;          // audio URL, or "local:<id>" for imported files
  duration?: number;    // seconds
  source: 'itunes' | 'jamendo' | 'archive' | 'local';
  preview?: boolean;    // true = 30s preview only
};
export type Playlist = { id: string; name: string; tracks: Track[] };
