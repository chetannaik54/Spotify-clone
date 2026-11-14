import { useSyncExternalStore } from 'react';
import type { Album } from './types';
export type Tab = 'home' | 'search' | 'library' | 'collector' | 'journey' | 'settings';
type Nav = { tab: Tab; album: Album | null; libSel: string | null; full: boolean };
let nav: Nav = { tab: 'home', album: null, libSel: null, full: false };
const subs = new Set<() => void>();
export const go = (p: Partial<Nav>) => { nav = { ...nav, ...p }; subs.forEach(f => f()); };
export const useNav = <T,>(sel: (n: Nav) => T): T => useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => sel(nav));
