import { createRoot } from 'react-dom/client';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource/anton/400.css';
import '@fontsource/permanent-marker/400.css';
import '@fontsource/oswald/400.css';
import '@fontsource/oswald/600.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/playfair-display/900.css';
import '@fontsource/playfair-display/900-italic.css';
import '@fontsource/dm-mono/500.css';
import '@fontsource/montserrat/800.css';
import '@fontsource/caveat/700.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/space-grotesk/700.css';
import './styles.css';
import { App } from './ui/App';
import { useStore } from './store';
import * as actions from './pipeline';
import { exportVideo } from './engine/export';

// Programmatic API for automation (Playwright, browser console, extensions): the whole studio is scriptable.
(window as any).BeatFrameApp = { store: useStore, actions, exportVideo };

// Make sure the engine fonts are ready before the first frame is drawn.
import { FONT_WEIGHT } from './engine/styles';
const faces = [...Object.entries(FONT_WEIGHT).map(([f, w]) => `${w} 40px "${f}"`), 'italic 900 40px "Playfair Display"'];
Promise.all(faces.map(f => document.fonts.load(f))).finally(() => createRoot(document.getElementById('root')!).render(<App />));
