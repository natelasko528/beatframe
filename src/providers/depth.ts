// Depth maps for "living stills" — computed on the user's device, no API key, no cost.
let worker: Worker | null = null; let device: 'webgpu' | 'wasm' | null = null;
const waiting = new Map<string, { res: (b: Blob) => void; rej: (e: Error) => void }>();
async function pick(): Promise<'webgpu' | 'wasm'> {
  if (device) return device;
  device = 'wasm';
  try { if ((navigator as any).gpu && await (navigator as any).gpu.requestAdapter()) device = 'webgpu'; } catch { /* CPU */ }
  return device;
}
export async function estimateDepth(id: string, image: Blob): Promise<Blob> {
  const dev = await pick();
  if (!worker) {
    worker = new Worker(new URL('./depth.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const m = e.data; const w = waiting.get(m.id); if (!w) return; if (m.type === 'done') { waiting.delete(m.id); w.res(m.png); } else if (m.type === 'error') { waiting.delete(m.id); w.rej(new Error(m.msg)); } };
  }
  return new Promise((res, rej) => { waiting.set(id, { res, rej }); worker!.postMessage({ id, blob: image, device: dev }); });
}
