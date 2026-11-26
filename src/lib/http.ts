import { Capacitor, CapacitorHttp } from '@capacitor/core';

/**
 * fetch() replacement for endpoints that don't send CORS headers (Google OAuth). Inside the Android app it goes
 * through Capacitor's native HTTP stack (no CORS); in a browser it is plain fetch.
 */
export const httpFetch: typeof fetch = async (input, init = {}) => {
  if (!Capacitor.isNativePlatform()) return fetch(input, init);
  const url = String(input); const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
  let data: unknown; const body = init.body;
  if (body instanceof URLSearchParams) { headers['content-type'] ??= 'application/x-www-form-urlencoded'; data = Object.fromEntries(body.entries()); }
  else if (typeof body === 'string') data = /json/.test(headers['content-type'] ?? '') ? JSON.parse(body) : body;
  const r = await CapacitorHttp.request({ url, method: (init.method ?? 'GET').toUpperCase(), headers, data, responseType: 'text' });
  const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
  return new Response([101, 204, 205, 304].includes(r.status) ? null : text, { status: r.status, headers: r.headers });
};

/**
 * Fetch binary content (album art) safely on both platforms. `httpFetch`'s native path reads the body as text,
 * which corrupts images, so this asks CapacitorHttp for base64 ('blob') instead. Never throws — returns null on
 * any failure (offline, 404, not an image) so a caller can always fall back to the original remote URL.
 */
export async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    if (!Capacitor.isNativePlatform()) { const r = await fetch(url); return r.ok ? await r.blob() : null; }
    const r = await CapacitorHttp.request({ url, method: 'GET', responseType: 'blob' });
    if (r.status < 200 || r.status >= 300 || typeof r.data !== 'string') return null;
    const type = r.headers?.['Content-Type'] ?? r.headers?.['content-type'] ?? 'application/octet-stream';
    const bin = atob(r.data); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  } catch { return null; }
}
