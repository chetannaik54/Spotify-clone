import { Capacitor, registerPlugin } from '@capacitor/core';

/** Secret storage. On Android this is Keystore-backed EncryptedSharedPreferences; the web fallback is dev-only. */
export interface SecureStore { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> }

export class MemorySecureStore implements SecureStore {
  m = new Map<string, string>();
  async get(k: string) { return this.m.get(k) ?? null; }
  async set(k: string, v: string) { this.m.set(k, v); }
  async remove(k: string) { this.m.delete(k); }
}

const Native = registerPlugin<{ get(o: { key: string }): Promise<{ value: string | null }>; set(o: { key: string; value: string }): Promise<void>; remove(o: { key: string }): Promise<void> }>('SecureStore');
export const nativeSecureStore: SecureStore = {
  get: async key => (await Native.get({ key })).value ?? null,
  set: async (key, value) => { await Native.set({ key, value }); },
  remove: async key => { await Native.remove({ key }); },
};
/** Browser dev fallback: sessionStorage (cleared when the tab closes). NOT used inside the Android app. */
export const sessionSecureStore: SecureStore = {
  get: async k => sessionStorage.getItem('sec:' + k), set: async (k, v) => sessionStorage.setItem('sec:' + k, v), remove: async k => sessionStorage.removeItem('sec:' + k),
};
export const secureStore: SecureStore = Capacitor.isNativePlatform() ? nativeSecureStore : sessionSecureStore;
