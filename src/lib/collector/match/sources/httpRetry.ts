/**
 * Retries a `fetch` call on a transient network failure (fetch() throwing — e.g. a DNS blip on mobile data or
 * Wi-Fi roaming), with a short back-off. An HTTP error status (4xx/5xx) is a normal resolved Response, not a
 * thrown exception, so it is returned as-is for the caller to handle; this only guards the request never
 * reaching a server at all. Never retries past an aborted signal.
 */
export async function fetchWithRetry(fetchImpl: typeof fetch, url: string, init: RequestInit = {}, attempts = 3): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fetchImpl(url, init); }
    catch (e) {
      last = e;
      if (init.signal?.aborted || i === attempts - 1) throw e;
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last;
}
