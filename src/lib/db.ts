// IndexedDB store for imported local audio files (so they survive restarts).
import { openDb } from './collector/kv';
const open = openDb; // one shared 'swarify' database (files + collector stores)
export async function putFile(id: string, blob: Blob) {
  const db = await open();
  await new Promise<void>((res, rej) => { const t = db.transaction('files', 'readwrite'); t.objectStore('files').put(blob, id); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
export async function getFile(id: string): Promise<Blob | undefined> {
  const db = await open();
  return new Promise((res, rej) => { const r = db.transaction('files').objectStore('files').get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
export async function delFile(id: string) {
  const db = await open();
  db.transaction('files', 'readwrite').objectStore('files').delete(id);
}
