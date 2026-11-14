const P: Record<string, string> = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  library: 'M4 4v16M9 4v16M14 6l6 14',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4',
  play: 'M7 4l13 8-13 8z', pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  next: 'M5 4l10 8-10 8zM17 4h2v16h-2z', prev: 'M19 4L9 12l10 8zM5 4h2v16H5z',
  shuffle: 'M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3',
  repeat: 'M4 11V9a3 3 0 013-3h13M17 3l3 3-3 3M20 13v2a3 3 0 01-3 3H4M7 21l-3-3 3-3',
  heart: 'M12 20s-8-5-8-11a4.5 4.5 0 018-2.5A4.5 4.5 0 0120 9c0 6-8 11-8 11z',
  queue: 'M4 6h12M4 11h12M4 16h7M16 14v6l5-3z', volume: 'M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 010 6',
  down: 'M6 9l6 6 6-6', back: 'M15 5l-7 7 7 7', plus: 'M12 5v14M5 12h14',
  folder: 'M3 6h6l2 2h10v11H3z', scan: 'M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M4 12h16',
  lyrics: 'M4 5h16v11H9l-5 4z', eq: 'M6 4v16M12 4v16M18 4v16M4 9h4M10 14h4M16 8h4',
  moon: 'M20 14A8 8 0 1110 4a6 6 0 0010 10z', note: 'M9 18V5l11-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM20 16a3 3 0 11-6 0 3 3 0 016 0z',
};
const FILLED = new Set(['play', 'pause', 'next', 'prev']);
export default function Icon({ n, size = 22, fill = false }: { n: keyof typeof P | string; size?: number; fill?: boolean }) {
  const f = fill || FILLED.has(n);
  return <svg viewBox="0 0 24 24" width={size} height={size} fill={f ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={f && FILLED.has(n) ? 1 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={P[n]} /></svg>;
}
