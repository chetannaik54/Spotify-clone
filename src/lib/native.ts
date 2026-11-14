import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type NativeTrack = { id: string; title: string; artist: string; album?: string; art?: string; url: string };
export type NativeState = {
  count: number; index: number; playing: boolean; state?: 'idle' | 'buffering' | 'ready' | 'ended';
  shuffle?: boolean; repeat?: 'off' | 'one' | 'all'; position?: number; duration?: number;
  currentId?: string; ids: string[]; tracks?: NativeTrack[];
};
export interface NativePlayerAPI {
  setQueue(o: { tracks: NativeTrack[]; index: number; position: number; play: boolean; keepCurrent: boolean }): Promise<void>;
  play(): Promise<void>; pause(): Promise<void>; next(): Promise<void>; previous(): Promise<void>;
  skipTo(o: { index: number }): Promise<void>; seekTo(o: { position: number }): Promise<void>;
  setShuffle(o: { enabled: boolean }): Promise<void>; setRepeat(o: { mode: 'off' | 'one' | 'all' }): Promise<void>;
  setVolume(o: { volume: number }): Promise<void>; setEq(o: { gains: number[] }): Promise<void>;
  setCrossfade(o: { seconds: number }): Promise<void>; setSleep(o: { at: number }): Promise<void>;
  getState(o?: { full?: boolean }): Promise<NativeState>;
  requestNotifications(): Promise<{ granted: boolean }>;
  addListener(ev: 'state', fn: (s: NativeState) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'time', fn: (t: { position: number; duration: number }) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'error', fn: (e: { message: string }) => void): Promise<PluginListenerHandle>;
}
/** True inside the Android app: playback is owned by the native foreground service. */
export const hasNativePlayer = Capacitor.isNativePlatform();
export const NativePlayer = registerPlugin<NativePlayerAPI>('NativePlayer');
