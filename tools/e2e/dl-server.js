// Test fixture for the emulator downloader test: serves a real WAV with HTTP Range support, throttled (so pause/resume is testable).
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const SR = 8000, SEC = 40, N = SR * SEC; const wav = Buffer.alloc(44 + N * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + N * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(SR, 24); wav.writeUInt32LE(SR * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) wav.writeInt16LE(Math.round(Math.sin(i / 7) * 3000), 44 + i * 2);
fs.writeFileSync('/tmp/e2e-song.sha256', crypto.createHash('sha256').update(wav).digest('hex')); fs.writeFileSync('/tmp/e2e-song.size', String(wav.length));
const log = m => fs.appendFileSync('/tmp/dl-server.log', m + '\n');
http.createServer((req, res) => {
  if (req.url.startsWith('/bad')) { res.writeHead(200, { 'Content-Length': 30000 }); return res.end(Buffer.alloc(30000, 65)); }
  if (req.url.startsWith('/missing')) { res.writeHead(404); return res.end('gone'); }
  const m = /bytes=(\d+)-/.exec(req.headers.range || ''); const start = m ? +m[1] : 0; log(`GET ${req.url} range=${req.headers.range || 'none'}`);
  res.writeHead(m ? 206 : 200, { 'Accept-Ranges': 'bytes', 'Content-Length': wav.length - start, ...(m ? { 'Content-Range': `bytes ${start}-${wav.length - 1}/${wav.length}` } : {}), 'Content-Type': 'audio/wav' });
  let off = start; const iv = setInterval(() => { if (off >= wav.length) { clearInterval(iv); return res.end(); } const n = Math.min(32 * 1024, wav.length - off); res.write(wav.subarray(off, off + n)); off += n; }, 250);   // ~128 KB/s
  req.on('close', () => clearInterval(iv));
}).listen(8765, '0.0.0.0', () => console.log('dl-server listening on 8765, size', wav.length));
