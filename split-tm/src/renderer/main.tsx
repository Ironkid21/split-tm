import { createRoot } from 'react-dom/client';
import '@fontsource/overpass/latin-200.css';      // headlines (ExtraLight), bundled locally: the app stays fully offline
import '@fontsource/overpass/latin-400.css';
import '@fontsource/overpass/latin-600.css';
import '@fontsource/overpass/latin-ext-400.css';
import '@fontsource/overpass/latin-ext-600.css';
import { App } from './App';
import './styles.css';
createRoot(document.getElementById('root')!).render(<App />);
