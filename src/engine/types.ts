// BeatFrame project schema. Everything the renderer needs is plain JSON, so a project can be
// saved, shared, re-rendered headlessly (CLI) or edited by hand.

export interface Word { d: string; s: number; e: number; m?: boolean }   // display text, start, end, matched-by-ASR
export interface Line {
  i: number; sec: string; text: string; words: Word[]; start: number; end: number; next: number;
  style: 'talk' | 'hook' | 'verse' | 'bridge';
  letter?: string | null;        // alphabet mode: "A for ..." lines
  stamp?: boolean;               // full-screen stamp line (short shouted lines)
}
export type Section = [name: string, start: number];

export interface Analysis {
  dur: number; tempo: number; beats: number[]; kicks: number[]; snares: number[];
  rms: number[]; curveDt: number; // loudness curve sampled every curveDt seconds
  features?: SongFeatures;
}
export interface SongFeatures { energy: number; brightness: number; density: number; dynamics: number; key: string; mode: 'major' | 'minor'; keyConfidence: number }

export interface Shot {
  from: number; to: number; img: string;           // img = asset id ('' for cards)
  z0: number; z1: number; x0: number; x1: number; y0: number; y1: number;
  kind?: 'open' | 'end' | 'title' | 'scene';
  letter?: string; flash?: boolean; drop?: boolean; whip?: boolean;
  caption?: string;                                 // location caption
}

export interface Sign { t: number; text: string; red?: boolean }        // keyword / street-sign pops
export interface LetterCue { t: number; ch: string; word: string; end: number; kind: 'verse' | 'bridge' }

export interface Scene {
  id: string; prompt: string; withAvatar: boolean; refIds: string[];   // refIds: avatar/location asset ids
  lyric?: string; word?: string;     // what the scene plays under (from the planner)
  idea?: string;                     // short visual idea (creative director); expanded into prompt by code
  custom?: boolean;                  // user wrote the full prompt by hand; never overwrite it
  status?: 'idle' | 'queued' | 'generating' | 'done' | 'error'; error?: string;
}
export interface Asset { id: string; name: string; kind: 'image' | 'avatar' | 'location' | 'cover'; url: string }

export interface Style {
  name: string;
  palette: { bg: string; text: string; accent: string; accent2: string; hot: string; sign: string; signAlt: string; shadowTint: string; highlightTint: string };
  fonts: { lyric: string; hot: string; ui: string; display: string };
  lyrics: {
    layout: 'lower-left' | 'center' | 'lower-center';
    size: number; hookScale: number; reveal: 'rise' | 'blur' | 'pop' | 'type';
    case: 'upper' | 'as-is'; hotWords: string[]; alliteration: boolean; activeColor: string;
  };
  motion: { kickZoom: number; cutPunch: number; shake: number; whipPans: boolean; letterMask: boolean };
  grade: { bloom: number; grain: number; vignette: number; lightLeak: number; leakColor: string; letterbox: number; chroma: boolean };
  particles: 'embers' | 'rain' | 'snow' | 'dust' | 'none';
  features: { signs: boolean; captions: boolean; bigLetters: boolean; ruler: boolean; dictionaryOpen: boolean; dropLockup: boolean; stamps: boolean; footer: boolean };
  transitions: { section: 'film-burn' | 'light-sweep' | 'flash' | 'none'; drop: 'flash' | 'flash-rgb' | 'none' };
}

export interface Meta { title: string; artist: string; tagline?: string; definition?: string[]; footer?: string }

export interface Project {
  version: 1;
  meta: Meta;
  width: number; height: number; fps: number;
  audio?: { name: string; url?: string };
  analysis?: Analysis;
  lyricsRaw: string;
  lines: Line[];
  sections: Section[]; drops: number[];
  letters: LetterCue[]; signs: Sign[];
  shots: Shot[];
  scenes: Scene[];
  assets: Asset[];
  style: Style;
  avatar: { description: string; refIds: string[] };
  plan: { mode: 'per-line' | 'alphabet' | 'beats'; beatsPerShot: number; coverId?: string; sceneBudget?: number };
  brief?: import('./director').Brief;       // the suggestion set (what the UI offers as "Suggested")
  mood?: string;
}
