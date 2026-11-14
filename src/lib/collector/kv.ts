/** Tiny async key-value interface so the catalogue works on IndexedDB (app) and memory (tests). */
export interface KV<T> {
  get(key: string): Promise<T | undefined>;
  put(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  all(): Promise<T[]>;
  clear(): Promise<void>;
}

export class MemoryKV<T> implements KV<T> {
  private m = new Map<string, T>();
  async get(k: string) { const v = this.m.get(k); return v === undefined ? undefined : structuredClone(v); }
  async put(k: string, v: T) { this.m.set(k, structuredClone(v)); }
  async del(k: string) { this.m.delete(k); }
  async all() { return [...this.m.values()].map(v => structuredClone(v)); }
  async clear() { this.m.clear(); }
}

/** IndexedDB-backed store inside the app's existing "swarify" database. */
export class IdbKV<T> implements KV<T> {
  constructor(private store: string) {}
  private tx<R>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<R>): Promise<R> {
    return openDb().then(db => new Promise<R>((res, rej) => { const r = f(db.transaction(this.store, mode).objectStore(this.store)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  }
  get(k: string) { return this.tx('readonly', s => s.get(k)) as Promise<T | undefined>; }
  async put(k: string, v: T) { await this.tx('readwrite', s => s.put(v, k)); }
  async del(k: string) { await this.tx('readwrite', s => s.delete(k)); }
  all() { return this.tx('readonly', s => s.getAll()) as Promise<T[]>; }
  async clear() { await this.tx('readwrite', s => s.clear()); }
}

export const DB_VERSION = 4;
export const COLLECTOR_STORES = ['c_tracks', 'c_playlists', 'c_syncs', 'c_accounts', 'c_matches', 'lyrics']; // 'lyrics' = offline lyric cache
let dbp: Promise<IDBDatabase> | null = null;
export function openDb(): Promise<IDBDatabase> {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('swarify', DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files'); // existing local-file store (v1)
      for (const s of COLLECTOR_STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
