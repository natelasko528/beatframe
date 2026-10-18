import type { Style } from './types';

// Font families are loaded from /public/fonts (see fonts.css). Any Google Font name works too if added there.
export const PRESETS: Record<string, Style> = {
  summer: {
    name: 'Summer Block Party',
    palette: { bg: '#050304', text: '#f6f1e8', accent: '#ffc94a', accent2: '#ff8a1f', hot: '#ff8a1f', sign: '#0d6b3c', signAlt: '#b31b22', shadowTint: 'rgba(20,70,90,.35)', highlightTint: 'rgba(255,150,60,.25)' },
    fonts: { lyric: 'Anton', hot: 'Permanent Marker', ui: 'Oswald', display: 'Anton' },
    lyrics: { layout: 'lower-left', size: 84, hookScale: 1.2, reveal: 'rise', case: 'upper', hotWords: ['MILWAUKEE', 'SUMMERTIME', 'COOKOUT', 'GRILL', 'OUTSIDE', 'SMOKE', 'FIREWORKS'], alliteration: false, activeColor: '#ffc94a' },
    motion: { kickZoom: 0.012, cutPunch: 0.035, shake: 3, whipPans: true, letterMask: false },
    grade: { bloom: 0.2, grain: 0.09, vignette: 0.55, lightLeak: 0.1, leakColor: '255,140,40', letterbox: 66, chroma: false },
    particles: 'embers',
    features: { signs: true, captions: true, bigLetters: false, ruler: false, dictionaryOpen: false, dropLockup: false, stamps: true, footer: false },
    transitions: { section: 'film-burn', drop: 'flash' },
  },
  alphabet: {
    name: 'Alphabet Hustler',
    palette: { bg: '#07080b', text: '#f1ead9', accent: '#e8c372', accent2: '#e1252f', hot: '#e8c372', sign: '#e1252f', signAlt: '#e8c372', shadowTint: 'rgba(10,60,90,.45)', highlightTint: 'rgba(240,190,110,.22)' },
    fonts: { lyric: 'Bebas Neue', hot: 'Playfair Display', ui: 'DM Mono', display: 'Playfair Display' },
    lyrics: { layout: 'lower-center', size: 86, hookScale: 1.2, reveal: 'blur', case: 'upper', hotWords: [], alliteration: true, activeColor: '#ffffff' },
    motion: { kickZoom: 0.01, cutPunch: 0.03, shake: 3.5, whipPans: false, letterMask: true },
    grade: { bloom: 0.22, grain: 0.1, vignette: 0.62, lightLeak: 0, leakColor: '150,190,255', letterbox: 92, chroma: true },
    particles: 'rain',
    features: { signs: false, captions: false, bigLetters: true, ruler: true, dictionaryOpen: true, dropLockup: true, stamps: false, footer: true },
    transitions: { section: 'light-sweep', drop: 'flash-rgb' },
  },
  neon: {
    name: 'Neon Night Drive',
    palette: { bg: '#05030a', text: '#f4f0ff', accent: '#ff3df2', accent2: '#29e7ff', hot: '#29e7ff', sign: '#7a2cff', signAlt: '#ff3df2', shadowTint: 'rgba(60,20,120,.45)', highlightTint: 'rgba(255,60,220,.2)' },
    fonts: { lyric: 'Bebas Neue', hot: 'Permanent Marker', ui: 'DM Mono', display: 'Bebas Neue' },
    lyrics: { layout: 'center', size: 92, hookScale: 1.25, reveal: 'pop', case: 'upper', hotWords: [], alliteration: false, activeColor: '#29e7ff' },
    motion: { kickZoom: 0.016, cutPunch: 0.05, shake: 4, whipPans: true, letterMask: false },
    grade: { bloom: 0.3, grain: 0.07, vignette: 0.6, lightLeak: 0.12, leakColor: '255,60,220', letterbox: 0, chroma: true },
    particles: 'dust',
    features: { signs: true, captions: true, bigLetters: false, ruler: false, dictionaryOpen: false, dropLockup: true, stamps: true, footer: false },
    transitions: { section: 'flash', drop: 'flash-rgb' },
  },
  gospel: {
    name: 'Golden Testimony',
    palette: { bg: '#0a0806', text: '#fff8ea', accent: '#ffd98a', accent2: '#ffffff', hot: '#ffd98a', sign: '#3a2a12', signAlt: '#ffd98a', shadowTint: 'rgba(40,30,20,.3)', highlightTint: 'rgba(255,220,150,.3)' },
    fonts: { lyric: 'Playfair Display', hot: 'Playfair Display', ui: 'Oswald', display: 'Playfair Display' },
    lyrics: { layout: 'center', size: 76, hookScale: 1.15, reveal: 'blur', case: 'as-is', hotWords: ['GOD', 'FAITH', 'GRACE', 'LIGHT'], alliteration: false, activeColor: '#ffd98a' },
    motion: { kickZoom: 0.006, cutPunch: 0.02, shake: 0, whipPans: false, letterMask: false },
    grade: { bloom: 0.35, grain: 0.06, vignette: 0.5, lightLeak: 0.18, leakColor: '255,210,140', letterbox: 80, chroma: false },
    particles: 'dust',
    features: { signs: false, captions: true, bigLetters: false, ruler: false, dictionaryOpen: false, dropLockup: false, stamps: true, footer: false },
    transitions: { section: 'light-sweep', drop: 'flash' },
  },
};

export const FONT_CHOICES = ['Anton', 'Bebas Neue', 'Oswald', 'Montserrat', 'Space Grotesk', 'Permanent Marker', 'Caveat', 'Playfair Display', 'Cinzel', 'DM Mono'];
/** The weight each family is loaded at (see main.tsx / CLI). */
export const FONT_WEIGHT: Record<string, string> = { 'Anton': '400', 'Bebas Neue': '400', 'Oswald': '600', 'Montserrat': '800', 'Space Grotesk': '700', 'Permanent Marker': '400', 'Caveat': '700', 'Playfair Display': '900', 'Cinzel': '700', 'DM Mono': '500' };

export const MOODS: Record<string, { grade: string; light: string }> = {
  'Golden summer': { grade: 'rich warm amber-and-teal hip-hop music video color grade', light: 'Golden hour, low orange sun, glowing haze.' },
  'After-dark luxury': { grade: 'moody luxury after-dark grade: deep inky blacks, steel-blue and teal shadows, rich champagne-gold highlights, a single crimson accent, glossy reflections, subtle haze', light: 'Night, rain-slick streets, city lights.' },
  'Neon night': { grade: 'saturated neon magenta and cyan night grade, glossy reflections, haze, high contrast', light: 'Night, neon signs, wet pavement.' },
  'Heavenly light': { grade: 'soft luminous golden grade, bright highlights, gentle bloom, warm whites', light: 'Sunbeams through haze, golden backlight.' },
  'Gritty street': { grade: 'gritty desaturated street grade, crushed blacks, cool shadows, film grain', light: 'Overcast daylight, harsh streetlights at night.' },
};
