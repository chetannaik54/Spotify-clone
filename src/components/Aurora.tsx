import { useEffect, useRef } from 'react';

/** Living background: soft colour blobs that drift, tinted by the current album art, with floating glow particles. */
export default function Aurora({ colors, playing }: { colors: string[]; playing: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const target = useRef(colors); target.current = colors;
  const play = useRef(playing); play.current = playing;

  useEffect(() => {
    const c = ref.current!; const x = c.getContext('2d')!;
    let w = 0, h = 0, raf = 0, t = 0;
    const resize = () => { const d = Math.min(devicePixelRatio, 1.5); w = c.width = innerWidth * d * 0.5; h = c.height = innerHeight * d * 0.5; };
    resize(); addEventListener('resize', resize);
    const parse = (s: string): [number, number, number] => { const m = s.match(/\d+/g)!; if (s.startsWith('#')) { const n = parseInt(s.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; } return [+m[0], +m[1], +m[2]]; };
    const cur = colors.map(parse);
    const blobs = Array.from({ length: 4 }, (_, i) => ({ ph: i * 1.7, sp: 0.18 + i * 0.07, r: 0.45 + i * 0.05 }));
    const dust = Array.from({ length: 40 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 1.6 + 0.4, v: Math.random() * 0.03 + 0.01 }));
    const loop = () => {
      t += play.current ? 0.012 : 0.004;
      target.current.forEach((c2, i) => { const g = parse(c2); for (let k = 0; k < 3; k++) cur[i][k] += (g[k] - cur[i][k]) * 0.02; });
      x.globalCompositeOperation = 'source-over'; x.fillStyle = '#0b0614'; x.fillRect(0, 0, w, h);
      x.globalCompositeOperation = 'lighter';
      blobs.forEach((b, i) => {
        const px = w * (0.5 + 0.38 * Math.sin(t * b.sp * 3 + b.ph)), py = h * (0.5 + 0.38 * Math.cos(t * b.sp * 2.3 + b.ph * 1.3));
        const r = Math.max(w, h) * b.r * (1 + 0.08 * Math.sin(t * 2 + i));
        const [R, G, B] = cur[i % cur.length].map(Math.round);
        const g = x.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, `rgba(${R},${G},${B},0.55)`); g.addColorStop(1, `rgba(${R},${G},${B},0)`);
        x.fillStyle = g; x.fillRect(0, 0, w, h);
      });
      x.fillStyle = 'rgba(255,255,255,.55)';
      dust.forEach(d => { d.y -= d.v * (play.current ? 1 : 0.3) * 0.01; if (d.y < 0) { d.y = 1; d.x = Math.random(); } x.globalAlpha = 0.3 + 0.3 * Math.sin(t * 3 + d.x * 9); x.beginPath(); x.arc(d.x * w + Math.sin(t + d.y * 6) * 6, d.y * h, d.s, 0, 7); x.fill(); });
      x.globalAlpha = 1;
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} className="aurora" />;
}
