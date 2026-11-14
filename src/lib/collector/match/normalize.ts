/** String normalisation + similarity used by the matcher. Pure and unit-tested. */

const strip = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Versions that make a recording a DIFFERENT recording of the same song. Remaster/radio edit are deliberately absent. */
const VERSION_TAGS: [string, RegExp][] = [
  ['remix', /\b(remix(ed)?|rmx|club mix|dj [a-z]+ mix|bootleg|flip)\b/],
  ['live', /\b(live|concert|in concert|live at|live from|live in)\b/],
  ['cover', /\b(cover|covered by|tribute|originally performed|in the style of|as made famous)\b/],
  ['instrumental', /\b(instrumental|backing track|without vocals)\b/],
  ['karaoke', /\b(karaoke|sing along version)\b/],
  ['acoustic', /\b(acoustic|unplugged|stripped|piano version|guitar version|orchestral|string version)\b/],
  ['slowed/sped', /\b(slowed|sped up|speed up|nightcore|reverb|8d|lofi|lo-fi|bass boosted|chill mix)\b/],
  ['mashup', /\b(mashup|mash-up|medley)\b/],
  ['alternate version', /\b(female version|male version|reprise|unreleased|demo|alternate|alt\. version|version 2|duet version)\b/],
];
export function versionTags(raw: string): Set<string> {
  const s = strip(raw); const out = new Set<string>();
  for (const [name, re] of VERSION_TAGS) if (re.test(s)) out.add(name);
  return out;
}

/** Title without decorations: brackets, "from <film>", feat., version/remaster tails, punctuation. */
export function baseTitle(raw: string): string {
  let s = strip(raw).replace(/&/g, ' and ');
  s = s.replace(/\|.*$/, ' ');                                          // "Title | www.site.com" → "Title"
  s = s.replace(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:com|in|net|org|co|info|pk|me)\b/g, ' ');   // stray website names in tags
  s = s.replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, ' ');
  s = s.replace(/\s[-–—]\s.*$/, ' ');                                   // "- Remastered 2011", "- From the film…"
  s = s.replace(/\b(feat\.?|ft\.?|featuring)\b.*$/, ' ');
  s = s.replace(/\bfrom\b\s+["“']?[^"”']+["”']?$/, ' ');
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

export function splitArtists(raw: string): string[] {
  return strip(raw).replace(/\b(feat\.?|ft\.?|featuring|with|vs\.?|and)\b/g, ',').replace(/&|×|\bx\b/g, ',').split(/[;,\/]+/)
    .map(a => a.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()).filter(a => a && a !== 'unknown artist' && a !== 'various artists' && a !== 'my music');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
export const levRatio = (a: string, b: string) => (a || b ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 1);

/** Title similarity in 0..1. Subsets (an extra word or two) score high but never perfect. */
export function titleSimilarity(a: string, b: string): number {
  const x = baseTitle(a), y = baseTitle(b); if (!x || !y) return 0;
  const lev = levRatio(x, y); if (x === y) return 1;
  const A = new Set(x.split(' ')), B = new Set(y.split(' ')); const inter = [...A].filter(t => B.has(t)).length;
  const small = Math.min(A.size, B.size), extra = Math.max(A.size, B.size) - small;
  const contain = inter === small && extra <= 2 && small >= 2 ? 0.85 : 0;
  return Math.max(lev, contain);
}

/** Artist similarity in 0..1, or null when EITHER side has no usable artist (label channels, untagged files) — an unknown is not a mismatch. */
export function artistSimilarity(source: string, candidate: string): number | null {
  const s = splitArtists(source), c = splitArtists(candidate);
  if (!s.length || !c.length) return null;
  const best = (a: string) => Math.max(...c.map(x => (x === a ? 1 : Math.max(levRatio(a, x), x.includes(a) || a.includes(x) ? 0.9 : 0))));
  const primary = best(s[0]); const overlap = s.map(best).reduce((m, v) => m + v, 0) / s.length;
  return +(0.6 * primary + 0.4 * overlap).toFixed(3);
}
