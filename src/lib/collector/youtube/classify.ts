/** Decide whether a YouTube video is probably a song, and pull out title / artist / movie. Pure + unit-tested. */

export type VideoFacts = { title: string; channel: string; categoryId?: string; durationSec?: number };
export type Classified = { isMusic: boolean; confidence: number; title: string; artist: string; album: string; reasons: string[] };

const LABEL = /\b(vevo|t-?series|zee music|sony music|saregama|tips (official|music)|yrf|think music|lahari|aditya music|speed records|times music|eros now music|venus|gaana|jiosaavn|t series|universal music|warner music|atlantic records|colors music|sun tv|goldmines)\b/i;
const NEGATIVE = /\b(podcast|interview|episode|trailer|tutorial|how to|review|reaction|vlog|gameplay|walkthrough|full movie|news|highlights|unboxing|recipe|lecture|sermon|speech|explained|documentary|stand[- ]?up)\b/i;
const COMPILATION = /\b(jukebox|non-?stop|mashup|top \d+|best of|\d+ (best )?songs|playlist|hours? of|medley|compilation)\b/i;
const SONG_WORDS = /\b(official|music video|video song|full song|lyrical|lyric(s)? video|lyrics|audio|song|visuali[sz]er|new song|full video)\b/i;
const NON_MUSIC_CATS = new Set(['20', '25', '27', '28', '26', '17', '19', '2', '15']);
const TRAIL = /\s+(full|video|videos|audio|lyrical|lyric|lyrics|official|hd|4k|song|songs|music|version|new|latest|hindi|whatsapp status)$/i;

export function parseTitle(rawTitle: string, channel: string): { title: string; artist: string; album: string } {
  let t = rawTitle.replace(/\s+/g, ' ').trim(); let album = '';
  const from = t.match(/[\(\[]\s*(?:from|film|movie)\s*[:\-]?\s*["“”']?([^\)\]"“”']+)["“”']?\s*[\)\]]/i);
  if (from) album = from[1].trim();
  t = t.replace(/[\(\[][^\)\]]*\b(official|video|audio|lyric|lyrical|lyrics|hd|4k|full|song|remaster(ed)?|live|karaoke|visuali[sz]er|music|from|film|movie|prod\.?)\b[^\)\]]*[\)\]]/gi, ' ').replace(/\s+/g, ' ').trim();
  let artist = '';
  const parts = t.split(/\s*\|\s*/).map(x => x.trim()).filter(Boolean);
  if (parts.length > 1) {
    t = parts[0];
    if (!album) { const cand = parts[1]; if (cand && !SONG_WORDS.test(cand) && cand.split(' ').length <= 6) album = cand; }
  }
  const dash = t.match(/^(.{2,40}?)\s+[-–—]\s+(.{2,})$/);
  if (dash && !/^\d+$/.test(dash[1])) { artist = dash[1].trim(); t = dash[2].trim(); }
  for (let i = 0; i < 6 && TRAIL.test(t); i++) t = t.replace(TRAIL, '').trim();
  t = t.replace(/\s*[-–|:]\s*$/, '').trim();
  const topic = channel.match(/^(.+?)\s*-\s*Topic$/i);
  if (!artist && topic) artist = topic[1].trim();
  if (!artist && channel && !LABEL.test(channel)) artist = channel.replace(/\s*(official|vevo)$/i, '').trim();
  return { title: t || rawTitle.trim(), artist, album };
}

export function classifyVideo(v: VideoFacts): Classified {
  const reasons: string[] = []; let s = 0;
  const add = (n: number, why: string) => { s += n; reasons.push(`${n > 0 ? '+' : ''}${n} ${why}`); };
  if (v.categoryId === '10') add(0.5, 'category: Music');
  else if (v.categoryId && NON_MUSIC_CATS.has(v.categoryId)) add(-0.4, `category ${v.categoryId}`);
  if (/-\s*Topic$/i.test(v.channel)) add(0.45, 'auto-generated “Topic” channel');
  else if (LABEL.test(v.channel)) add(0.3, 'music label channel');
  if (SONG_WORDS.test(v.title)) add(0.25, 'title says song/video/lyrics/audio');
  if (/^.{2,40}\s[-–—]\s.{2,}$/.test(v.title)) add(0.1, '“Artist - Title” pattern');
  if (v.durationSec) {
    if (v.durationSec >= 90 && v.durationSec <= 540) add(0.15, 'song-length duration');
    else if (v.durationSec > 1500) add(-0.3, 'longer than 25 minutes');
    else if (v.durationSec < 45) add(-0.25, 'under 45 seconds');
  }
  if (NEGATIVE.test(v.title)) add(-0.5, 'looks like talk/review/trailer content');
  if (COMPILATION.test(v.title)) add(-0.45, 'looks like a compilation, not one song');
  const confidence = Math.max(0, Math.min(1, +s.toFixed(2)));
  const p = parseTitle(v.title, v.channel);
  return { isMusic: confidence >= 0.5, confidence, reasons, ...p };
}

/** ISO-8601 duration (PT3M45S, PT1H2M) → seconds. */
export function isoDurationSeconds(d?: string): number {
  const m = d?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/); if (!m) return 0;
  return (+(m[1] ?? 0)) * 86400 + (+(m[2] ?? 0)) * 3600 + (+(m[3] ?? 0)) * 60 + (+(m[4] ?? 0));
}
