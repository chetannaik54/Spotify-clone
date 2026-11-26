import { describe, expect, it } from 'vitest';
import { fetchWithRetry } from '../src/lib/collector/match/sources/httpRetry';

const ok = () => new Response('{}', { status: 200 });

describe('fetchWithRetry (shared by Jamendo, Internet Archive and SoundCloud)', () => {
  it('passes a successful call straight through, with no retry', async () => {
    let calls = 0; const r = await fetchWithRetry(async () => { calls++; return ok(); }, 'https://x');
    expect(r.status).toBe(200); expect(calls).toBe(1);
  });
  it('retries a thrown network error and returns the eventual success', async () => {
    let calls = 0;
    const r = await fetchWithRetry(async () => { calls++; if (calls < 2) throw new TypeError('Failed to fetch'); return ok(); }, 'https://x');
    expect(r.status).toBe(200); expect(calls).toBe(2);
  });
  it('gives up after the configured attempts and throws the last error', async () => {
    let calls = 0;
    await expect(fetchWithRetry(async () => { calls++; throw new Error('Unable to resolve host'); }, 'https://x', {}, 2)).rejects.toThrow('Unable to resolve host');
    expect(calls).toBe(2);
  });
  it('does not retry an HTTP error status — only a thrown network failure', async () => {
    let calls = 0; const r = await fetchWithRetry(async () => { calls++; return new Response(null, { status: 404 }); }, 'https://x');
    expect(r.status).toBe(404); expect(calls).toBe(1);
  });
  it('stops immediately once the signal is already aborted, without retrying', async () => {
    const ac = new AbortController(); ac.abort(); let calls = 0;
    await expect(fetchWithRetry(async () => { calls++; throw new Error('aborted'); }, 'https://x', { signal: ac.signal })).rejects.toThrow();
    expect(calls).toBe(1);
  });
}, 10000);
