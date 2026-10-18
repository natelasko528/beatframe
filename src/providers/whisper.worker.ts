// Local, free speech-to-text in the browser (transformers.js). Model files download once from Hugging Face and are cached.
import { pipeline, env } from '@huggingface/transformers';
env.allowLocalModels = false;
let asr: any = null, loaded = '';
const post = (m: any) => (self as any).postMessage(m);
async function run(audio: Float32Array, model: string, device: 'webgpu' | 'wasm') {
  const key = model + device;
  if (!asr || loaded !== key) {
    asr = await pipeline('automatic-speech-recognition', model, {
      device, dtype: device === 'webgpu' ? 'fp32' : 'q8',
      progress_callback: (p: any) => { if (p.status === 'progress') post({ type: 'download', file: p.file, progress: p.progress }); },
    });
    loaded = key;
  }
  post({ type: 'status', msg: 'Transcribing…' });
  // English-only (.en) models reject a task option; multilingual models detect the language themselves
  return asr(audio, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5, ...(model.endsWith('.en') ? {} : { task: 'transcribe' }) });
}
self.onmessage = async (e: MessageEvent) => {
  const { audio, model, device } = e.data as { audio: Float32Array; model: string; device: 'webgpu' | 'wasm' };
  try {
    let out: any;
    try { out = await run(audio, model, device); }
    catch (err) {
      // navigator.gpu can exist with no usable adapter (many laptops, headless, some Safari builds): fall back to WebAssembly
      if (device !== 'webgpu') throw err;
      asr = null; post({ type: 'status', msg: 'No usable GPU, transcribing on the CPU (slower)…' });
      out = await run(audio, model, 'wasm');
    }
    const words = (out.chunks || []).map((c: any) => ({ w: c.text.trim(), s: c.timestamp[0], e: c.timestamp[1] ?? c.timestamp[0] + 0.3 })).filter((w: any) => w.w);
    post({ type: 'done', words });
  } catch (err: any) { post({ type: 'error', msg: String(err?.message || err) }); }
};
