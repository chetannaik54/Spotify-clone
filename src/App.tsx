import { useEffect, useState } from 'react';
import Aurora from './components/Aurora';
import { Home, Library, Search, Settings } from './components/Views';
import { MiniBar, NowPlaying } from './components/NowPlaying';
import { current, useStore } from './lib/store';
import { useEngine } from './lib/engine';
import { paletteFrom } from './lib/colors';

const TABS = [['home', '🏠', 'Home'], ['search', '🔍', 'Search'], ['library', '📚', 'Library'], ['settings', '⚙️', 'Settings']] as const;
const DEFAULT = ['#7c3aed', '#ec4899', '#f59e0b', '#06b6d4'];

export default function App() {
  useEngine();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('home');
  const [full, setFull] = useState(false);
  const art = useStore(s => current(s)?.art); const playing = useStore(s => s.playing);
  const [colors, setColors] = useState(DEFAULT);
  useEffect(() => { if (art) paletteFrom(art).then(setColors); else setColors(DEFAULT); }, [art]);
  return (
    <>
      <Aurora colors={colors} playing={playing} />
      <div className="shell">
        <nav className="side">
          <div className="logo">♪ Swarify <small>Premium</small></div>
          {TABS.map(([id, ic, name]) => <button key={id} className={tab === id ? 'sel' : ''} onClick={() => setTab(id)}><span>{ic}</span><em>{name}</em></button>)}
        </nav>
        <main>{tab === 'home' ? <Home /> : tab === 'search' ? <Search /> : tab === 'library' ? <Library /> : <Settings />}</main>
      </div>
      <MiniBar onOpen={() => setFull(true)} />
      {full && <NowPlaying onClose={() => setFull(false)} />}
    </>
  );
}
