import { useEffect, useState } from 'react';
import Aurora from './components/Aurora';
import Icon from './components/Icon';
import { AlbumView, Home, Library, Search, Settings } from './components/Views';
import Collector from './components/Collector';
import Journey from './components/Journey';
import { initCollector } from './lib/collector/service';
import { MiniBar, NowPlaying } from './components/NowPlaying';
import { current, useStore } from './lib/store';
import { go, useNav, type Tab } from './lib/nav';
import { useEngine } from './lib/engine';
import { paletteFrom } from './lib/colors';

const TABS: [Tab, string, string][] = [['home', 'home', 'Home'], ['search', 'search', 'Search'], ['library', 'library', 'Library'], ['collector', 'collect', 'Collector'], ['journey', 'journey', 'Journey'], ['settings', 'settings', 'Settings']];
const DEFAULT = ['#7c3aed', '#ec4899', '#f59e0b', '#06b6d4'];

export default function App() {
  useEngine();
  useEffect(() => { initCollector(); }, []);
  const tab = useNav(n => n.tab); const album = useNav(n => n.album); const full = useNav(n => n.full);
  const art = useStore(s => current(s)?.art); const playing = useStore(s => s.playing);
  const [colors, setColors] = useState(DEFAULT);
  useEffect(() => { if (art) paletteFrom(art).then(setColors); else setColors(DEFAULT); }, [art]);
  const nav = (id: Tab) => go({ tab: id, album: null });
  return (
    <>
      <Aurora colors={colors} playing={playing} />
      <div className="app">
        <nav className="side" aria-label="Primary">
          <div className="logo"><span className="mark">♪</span><span className="word">Swarify</span><small>Premium</small></div>
          {TABS.map(([id, ic, name]) => <button key={id} className={tab === id ? 'sel' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => nav(id)}><Icon n={ic} /><em>{name}</em></button>)}
        </nav>
        <div className="col">
          <main key={tab + (album?.id ?? '')}>{album && tab === 'home' ? <AlbumView /> : album ? <AlbumView /> : tab === 'home' ? <Home /> : tab === 'search' ? <Search /> : tab === 'library' ? <Library /> : tab === 'collector' ? <Collector /> : tab === 'journey' ? <Journey /> : <Settings />}</main>
          <MiniBar />
          <nav className="tabbar" aria-label="Primary mobile">
            {TABS.map(([id, ic, name]) => <button key={id} className={tab === id ? 'sel' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => nav(id)}><Icon n={ic} size={22} /><span>{name}</span></button>)}
          </nav>
        </div>
      </div>
      {full && <NowPlaying />}
    </>
  );
}
