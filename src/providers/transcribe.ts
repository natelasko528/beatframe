import type { AsrWord } from '../engine/align';
import { pfetch, type KeySettings } from './keys';

export type AsrEngine = { kind: 'local'; model: string } | { kind: 'openai'; model: string };
export const LOCAL_ASR_MODELS = ['onnx-community/whisper-base.en', 'onnx-community/whisper-small.en', 'onnx-community/whisper-tiny.en'];

async function to16k(buffer: AudioBuffer): Promise<Float32Array> {
  const off = new OfflineAudioContext(1, Math.ceil(buffer.duration * 16000), 16000);
  const src = off.createBufferSource(); src.buffer = buffer; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0);
}

export async function transcribe(engine: AsrEngine, audio: AudioBuffer, file: Blob | null, keys: KeySettings, onStatus: (s: string) => void): Promise<AsrWord[]> {
  if (engine.kind === 'openai') {
    const key = keys.keys.openai; if (!key) throw new Error('Add your OpenAI key in Settings, or use the free local engine.');
    if (!file) throw new Error('Original audio file missing');
    onStatus('Uploading to OpenAI Whisper…');
    const fd = new FormData(); fd.append('file', file, (file as any).name || 'track.mp3'); fd.append('model', engine.model);
    fd.append('response_format', 'verbose_json'); fd.append('timestamp_granularities[]', 'word');
    const r = await pfetch(keys, `${keys.openaiBase.replace(/\/$/, '')}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd });
    if (!r.ok) throw new Error(`OpenAI: ${r.status} ${(await r.text()).slice(0, 200)}`);
    const j = await r.json(); return (j.words || []).map((w: any) => ({ w: w.word, s: w.start, e: w.end }));
  }
  const pcm = await to16k(audio);
  const device = (navigator as any).gpu ? 'webgpu' : 'wasm';
  onStatus(`Loading ${engine.model.split('/')[1]} (${device}) — first run downloads the model once…`);
  const worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((res, rej) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'download') onStatus(`Downloading model ${Math.round(m.progress || 0)}%`);
      else if (m.type === 'status') onStatus(m.msg);
      else if (m.type === 'done') { worker.terminate(); res(m.words); }
      else if (m.type === 'error') { worker.terminate(); rej(new Error(m.msg)); }
    };
    worker.postMessage({ audio: pcm, model: engine.model, device }, [pcm.buffer]);
  });
}
