import type { Track } from '../types';

export type AudioCategory = 'story:mystery' | 'story:horror' | 'story:comedy' | 'story:romance' | 'story:thriller' | 'story:short' | 'podcast' | 'sleep:rain' | 'sleep:ocean' | 'sleep:nature' | 'sleep:ambient' | 'sleep:guided';
export type AudioKind = 'story' | 'podcast' | 'sleep';
export type AudioItem = { id: string; category: AudioCategory; trackId: string; title?: string; series?: string; addedAt: number };

export const CATEGORIES: { id: AudioCategory; kind: AudioKind; label: string; keywords: RegExp }[] = [
  { id: 'story:mystery', kind: 'story', label: 'Mystery', keywords: /\b(mystery|detective|sherlock|investigat|whodunit|karamchand|byomkesh)\b/i },
  { id: 'story:horror', kind: 'story', label: 'Horror', keywords: /\b(horror|ghost|haunted|bhoot|scary|paranormal|creepy|vampire)\b/i },
  { id: 'story:comedy', kind: 'story', label: 'Comedy', keywords: /\b(comedy|funny|humou?r|hasya|laugh|sitcom|satire)\b/i },
  { id: 'story:romance', kind: 'story', label: 'Romance', keywords: /\b(romance|love story|prem kahani|romantic story)\b/i },
  { id: 'story:thriller', kind: 'story', label: 'Thriller', keywords: /\b(thriller|suspense|crime|heist|spy|murder)\b/i },
  { id: 'story:short', kind: 'story', label: 'Short stories', keywords: /\b(short stor|kahani|kahaniya|audiobook|audio book|story|stories|katha|librivox)\b/i },
  { id: 'podcast', kind: 'podcast', label: 'Podcasts', keywords: /\b(podcast|episode|ep\.?\s*\d+|season \d+|s\d+e\d+|interview|talk show)\b/i },
  { id: 'sleep:rain', kind: 'sleep', label: 'Rain', keywords: /\b(rain|barish|baarish|thunder|monsoon|drizzle|storm)\b/i },
  { id: 'sleep:ocean', kind: 'sleep', label: 'Ocean', keywords: /\b(ocean|sea|waves?|beach|shore|tide|samundar)\b/i },
  { id: 'sleep:nature', kind: 'sleep', label: 'Nature', keywords: /\b(nature|forest|jungle|birds?|crickets?|river|stream|waterfall|wind|campfire|night sounds)\b/i },
  { id: 'sleep:ambient', kind: 'sleep', label: 'Ambient music', keywords: /\b(ambient|drone|white noise|brown noise|pink noise|lo-?fi|sleep music|calm music|deep sleep|soundscape)\b/i },
  { id: 'sleep:guided', kind: 'sleep', label: 'Guided relaxation', keywords: /\b(guided|meditation|relaxation|yoga nidra|body scan|breathing|mindfulness|hypnosis)\b/i },
];
export const catOf = (id: AudioCategory) => CATEGORIES.find(c => c.id === id)!;
export const KIND_LABEL: Record<AudioKind, string> = { story: 'Audio Stories', podcast: 'Podcasts', sleep: 'Sleep sounds' };

/** Suggest a category from a file's title / album / folder / genre. Pure heuristics — the user confirms. */
export function suggestCategory(t: Pick<Track, 'title' | 'album' | 'folder' | 'genre' | 'artist'>): AudioCategory | null {
  const hay = `${t.title} ${t.album ?? ''} ${t.folder ?? ''} ${t.genre ?? ''} ${t.artist ?? ''}`;
  // specific categories before the generic "story"/"podcast" catch-alls
  for (const c of CATEGORIES) if (c.keywords.test(hay) && !['story:short', 'podcast'].includes(c.id)) return c.id;
  return CATEGORIES.find(c => c.id === 'podcast')!.keywords.test(hay) ? 'podcast' : CATEGORIES.find(c => c.id === 'story:short')!.keywords.test(hay) ? 'story:short' : null;
}

export type ResolvedItem = { item: AudioItem; track: Track | null; missing: boolean };
export function resolveItems(items: AudioItem[], local: Track[]): ResolvedItem[] {
  const by = new Map(local.map(t => [t.id, t])); return items.map(item => { const track = by.get(item.trackId) ?? null; return { item, track, missing: !track || !track.url }; });
}
export const byKind = (items: ResolvedItem[], kind: AudioKind) => items.filter(r => catOf(r.item.category).kind === kind);
export function addItem(items: AudioItem[], trackId: string, category: AudioCategory, now = Date.now()): AudioItem[] {
  return items.some(i => i.trackId === trackId) ? items.map(i => (i.trackId === trackId ? { ...i, category } : i)) : [...items, { id: `al-${trackId}`, trackId, category, addedAt: now }];
}
/** Episodes of one series (album) in play order: by title with natural number ordering. */
export const episodeOrder = (a: Track, b: Track) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
