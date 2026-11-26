import { describe, expect, it, vi } from 'vitest';
import { fetchBlob } from '../src/lib/http';

describe('fetchBlob (non-native / plain fetch path)', () => {
  it('returns the body as a Blob on a 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(new Uint8Array(10), { status: 200 }));
    const b = await fetchBlob('https://cdn/a.jpg'); expect(b).not.toBeNull(); expect(b!.size).toBe(10);
  });
  it('returns null on a non-OK response rather than throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await fetchBlob('https://cdn/missing.jpg')).toBeNull();
  });
  it('returns null (never throws) when the network request itself fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    expect(await fetchBlob('https://cdn/a.jpg')).toBeNull();
  });
});
