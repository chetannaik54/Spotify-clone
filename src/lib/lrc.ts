export type Line = { t: number; text: string };
export function parseLrc(s: string): Line[] | null {
  const out: Line[] = [];
  for (const row of s.split('\n')) {
    const m = row.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (m) out.push({ t: +m[1] * 60 + +m[2], text: m[3].trim() });
  }
  return out.length ? out : null;
}
