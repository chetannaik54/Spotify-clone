/** Extract a small vibrant palette from an image URL (for the dynamic background). */
export async function paletteFrom(url: string): Promise<string[]> {
  const fallback = ['#7c3aed', '#ec4899', '#f59e0b', '#06b6d4'];
  try {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url;
    await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d')!; x.drawImage(img, 0, 0, 32, 32);
    const px = x.getImageData(0, 0, 32, 32).data;
    const bins = new Map<string, { r: number; g: number; b: number; n: number; s: number }>();
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
      if (mx < 40 || sat < 0.25) continue;
      const k = `${r >> 6}${g >> 6}${b >> 6}`;
      const e = bins.get(k) ?? { r: 0, g: 0, b: 0, n: 0, s: 0 };
      e.r += r; e.g += g; e.b += b; e.n++; e.s += sat; bins.set(k, e);
    }
    const cols = [...bins.values()].sort((a, b) => b.n * b.s - a.n * a.s).slice(0, 4)
      .map(e => `rgb(${Math.round(e.r / e.n)},${Math.round(e.g / e.n)},${Math.round(e.b / e.n)})`);
    while (cols.length && cols.length < 4) cols.push(cols[cols.length % cols.length]);
    return cols.length ? cols : fallback;
  } catch { return fallback; }
}
