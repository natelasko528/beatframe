import { create } from 'zustand';
import type { Project } from './engine/types';
import { PRESETS } from './engine/styles';
import { DEFAULT_KEYS, type KeySettings } from './providers/keys';
import type { ImageModel } from './providers/images';
import type { LlmModel } from './providers/llm';
import type { AsrEngine } from './providers/transcribe';

export type Screen = 'start' | 'producing' | 'studio';
export type Tab = 'vibe' | 'scenes' | 'words' | 'cast' | 'export';
export type StepId = 'beat' | 'words' | 'brief' | 'edit' | 'scenes' | 'ready';
export interface RunStep { id: StepId; label: string; status: 'wait' | 'run' | 'done' | 'skip' | 'error'; detail?: string }

export function newProject(): Project {
  return {
    version: 1, meta: { title: 'Untitled', artist: '', tagline: '' }, width: 1920, height: 1080, fps: 30,
    lyricsRaw: '', lines: [], sections: [], drops: [], letters: [], signs: [], shots: [], scenes: [], assets: [],
    style: structuredClone(PRESETS.alphabet), avatar: { description: '', refIds: [] }, plan: { mode: 'per-line', beatsPerShot: 4, sceneBudget: 24 },
    mood: 'After-dark luxury',
  };
}

export const RUN_STEPS: RunStep[] = [
  { id: 'beat', label: 'Beat and tempo', status: 'wait' },
  { id: 'words', label: 'Lyrics timed to the vocal', status: 'wait' },
  { id: 'brief', label: 'Creative brief', status: 'wait' },
  { id: 'edit', label: 'Edit cut to the beat', status: 'wait' },
  { id: 'scenes', label: 'Scenes', status: 'wait' },
  { id: 'ready', label: 'Preview', status: 'wait' },
];

interface State {
  screen: Screen; tab: Tab; project: Project;
  audioFile: File | null; audioBuffer: AudioBuffer | null; audioUrl: string | null;
  images: Record<string, ImageBitmap>;          // decoded assets by id
  blobs: Record<string, Blob>;                  // original asset blobs by id
  keys: KeySettings; imageModel: ImageModel; llm: LlmModel | null; asr: AsrEngine;
  run: RunStep[]; runError: string;
  time: number; playing: boolean; status: string; busy: boolean;
  set: (p: Partial<State>) => void;
  update: (fn: (p: Project) => void) => void;
  step: (id: StepId, status: RunStep['status'], detail?: string) => void;
}

export const useStore = create<State>((set, get) => ({
  screen: 'start', tab: 'vibe', project: newProject(), audioFile: null, audioBuffer: null, audioUrl: null, images: {}, blobs: {},
  keys: DEFAULT_KEYS, imageModel: { provider: 'openai', model: 'gpt-image-1', quality: 'medium' }, llm: null,
  asr: { kind: 'local', model: 'onnx-community/whisper-base.en' },
  run: structuredClone(RUN_STEPS), runError: '',
  time: 0, playing: false, status: '', busy: false,
  set: (p) => set(p as any),
  update: (fn) => { const p = structuredClone(get().project); fn(p); set({ project: p }); },
  step: (id, status, detail) => set({ run: get().run.map(s => (s.id === id ? { ...s, status, detail: detail ?? s.detail } : s)) }),
}));
