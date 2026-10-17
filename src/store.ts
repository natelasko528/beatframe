import { create } from 'zustand';
import type { Project } from './engine/types';
import { PRESETS } from './engine/styles';
import { DEFAULT_KEYS, type KeySettings } from './providers/keys';
import type { ImageModel } from './providers/images';
import type { LlmModel } from './providers/llm';
import type { AsrEngine } from './providers/transcribe';

export type Step = 'song' | 'words' | 'look' | 'cast' | 'scenes' | 'edit' | 'export';

export function newProject(): Project {
  return {
    version: 1, meta: { title: 'Untitled', artist: '', tagline: '' }, width: 1920, height: 1080, fps: 30,
    lyricsRaw: '', lines: [], sections: [], drops: [], letters: [], signs: [], shots: [], scenes: [], assets: [],
    style: structuredClone(PRESETS.summer), avatar: { description: '', refIds: [] }, plan: { mode: 'per-line', beatsPerShot: 4 },
  };
}

interface State {
  step: Step; project: Project;
  audioFile: File | null; audioBuffer: AudioBuffer | null; audioUrl: string | null;
  images: Record<string, ImageBitmap>;          // decoded assets by id
  blobs: Record<string, Blob>;                  // original asset blobs by id
  keys: KeySettings; imageModel: ImageModel; llm: LlmModel | null; asr: AsrEngine;
  mood: string; city: string; signWords: string;
  time: number; playing: boolean; status: string; busy: boolean;
  set: (p: Partial<State>) => void;
  update: (fn: (p: Project) => void) => void;
}

export const useStore = create<State>((set, get) => ({
  step: 'song', project: newProject(), audioFile: null, audioBuffer: null, audioUrl: null, images: {}, blobs: {},
  keys: DEFAULT_KEYS, imageModel: { provider: 'openai', model: 'gpt-image-1', quality: 'medium' }, llm: null,
  asr: { kind: 'local', model: 'onnx-community/whisper-base.en' },
  mood: 'Golden summer', city: '', signWords: '',
  time: 0, playing: false, status: '', busy: false,
  set: (p) => set(p as any),
  update: (fn) => { const p = structuredClone(get().project); fn(p); set({ project: p }); },
}));
