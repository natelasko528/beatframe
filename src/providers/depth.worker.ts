// Free, on-device depth estimation (Depth Anything V2 small via transformers.js). Model downloads once and is cached.
import { pipeline, env, RawImage } from '@huggingface/transformers';
env.allowLocalModels = false;
const MODEL = 'onnx-community/depth-anything-v2-small';
let est: any = null, dev = '';
const post = (m: any) => (self as any).postMessage(m);
async function load(device: 'webgpu' | 'wasm') {
  if (est && dev === device) return est;
  est = await pipeline('depth-estimation', MODEL, { device, dtype: device === 'webgpu' ? 'fp32' : 'q8',
    progress_callback: (p: any) => { if (p.status === 'progress') post({ type: 'download', progress: p.progress }); } });
  dev = device; return est;
}
self.onmessage = async (e: MessageEvent) => {
  const { id, blob, device } = e.data as { id: string; blob: Blob; device: 'webgpu' | 'wasm' };
  try {
    const img = await RawImage.fromBlob(blob);
    let out: any;
    try { out = await (await load(device))(img); }
    catch (err) { if (device !== 'webgpu') throw err; est = null; out = await (await load('wasm'))(img); }
    const d: RawImage = out.depth;                       // 1-channel, near = bright
    const png = await (await d.resize(img.width, img.height)).toBlob('image/png');
    post({ type: 'done', id, png });
  } catch (err: any) { post({ type: 'error', id, msg: String(err?.message || err) }); }
};
