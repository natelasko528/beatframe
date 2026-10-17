// Local, free speech-to-text in the browser (transformers.js). Model files download once from Hugging Face and are cached.
import { pipeline, env } from '@huggingface/transformers';
env.allowLocalModels = false;
let asr: any = null, loaded = '';
self.onmessage = async (e: MessageEvent) => {
  const { audio, model, device } = e.data as { audio: Float32Array; model: string; device: 'webgpu' | 'wasm' };
  try {
    if (!asr || loaded !== model) {
      asr = await pipeline('automatic-speech-recognition', model, {
        device, dtype: device === 'webgpu' ? 'fp32' : 'q8',
        progress_callback: (p: any) => { if (p.status === 'progress') (self as any).postMessage({ type: 'download', file: p.file, progress: p.progress }); },
      });
      loaded = model;
    }
    (self as any).postMessage({ type: 'status', msg: 'Transcribing…' });
    const out = await asr(audio, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5, language: 'english', task: 'transcribe' });
    const words = (out.chunks || []).map((c: any) => ({ w: c.text.trim(), s: c.timestamp[0], e: c.timestamp[1] ?? c.timestamp[0] + 0.3 })).filter((w: any) => w.w);
    (self as any).postMessage({ type: 'done', words });
  } catch (err: any) { (self as any).postMessage({ type: 'error', msg: String(err?.message || err) }); }
};
