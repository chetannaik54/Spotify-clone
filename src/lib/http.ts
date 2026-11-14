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
