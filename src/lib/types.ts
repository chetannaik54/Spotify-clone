export type Track = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  art: string;          // artwork URL (or data URL)
  url: string;          // audio URL, or "local:<id>" for imported files
  duration?: number;    // seconds
  source: 'itunes' | 'jamendo' | 'archive' | 'local';
  preview?: boolean;
  size?: number;        // bytes (local files)
  genre?: string;
  year?: number;
  unavailable?: string; // placeholder entry of an imported playlist: why it can't play yet
  folder?: string;      // device folder for scanned local files    // true = 30s preview only
};
export type Playlist = { id: string; name: string; tracks: Track[]; source?: { platform: string; playlistId: string; importedAt: number; total: number; art?: string } };
export type Album = { id: string; title: string; artist: string; art: string };
