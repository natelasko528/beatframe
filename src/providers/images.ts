// Image generation adapters. Each takes a prompt + optional reference images (Blobs) and returns an image Blob.
import { pfetch, type KeySettings } from './keys';

export interface ImageModel { provider: 'openai' | 'gemini' | 'fal'; model: string; quality: 'low' | 'medium' | 'high' }
export const IMAGE_MODEL_SUGGESTIONS: Record<ImageModel['provider'], string[]> = {
  openai: ['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5'],
  gemini: ['gemini-2.5-flash-image', 'gemini-3.1-flash-image', 'gemini-3-pro-image-preview'],
  fal: ['fal-ai/flux-pro/kontext', 'fal-ai/flux-pro/kontext/max', 'fal-ai/nano-banana/edit', 'fal-ai/flux/dev'],
};

const toB64 = async (b: Blob) => { const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s: string, type = 'image/png') => new Blob([Uint8Array.from(atob(s), c => c.charCodeAt(0))], { type });
async function check(r: Response) { if (!r.ok) { let msg = `${r.status}`; try { const j = await r.json(); msg = j.error?.message || j.detail || j.message || JSON.stringify(j).slice(0, 300); } catch { msg += ' ' + (await r.text()).slice(0, 300); } throw new Error(msg); } return r; }

export async function generateImage(s: KeySettings, m: ImageModel, prompt: string, refs: Blob[], aspect: '16:9' | '9:16'): Promise<Blob> {
  if (m.provider === 'openai') {
    const key = s.keys.openai; if (!key) throw new Error('Add your OpenAI API key in Settings.');
    const size = aspect === '16:9' ? '1536x1024' : '1024x1536', base = s.openaiBase.replace(/\/$/, '');
    let r: Response;
    if (refs.length) {
      const fd = new FormData(); fd.append('model', m.model); fd.append('prompt', prompt); fd.append('size', size); fd.append('quality', m.quality); fd.append('n', '1');
      refs.slice(0, 8).forEach((b, i) => fd.append('image[]', b, `ref${i}.png`));
      r = await pfetch(s, `${base}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd });
    } else {
      r = await pfetch(s, `${base}/images/generations`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: m.model, prompt, size, quality: m.quality, n: 1 }) });
    }
    const j = await (await check(r)).json(); const d = j.data?.[0];
    if (d?.b64_json) return fromB64(d.b64_json);
    if (d?.url) return (await fetch(d.url)).blob();
    throw new Error('No image returned');
  }
  if (m.provider === 'gemini') {
    const key = s.keys.gemini; if (!key) throw new Error('Add your Gemini API key in Settings.');
    const parts: any[] = [];
    for (const b of refs.slice(0, 6)) parts.push({ inlineData: { mimeType: b.type || 'image/jpeg', data: await toB64(b) } });
    parts.push({ text: prompt });
    const r = await pfetch(s, `https://generativelanguage.googleapis.com/v1beta/models/${m.model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } } }) });
    const j = await (await check(r)).json();
    const img = j.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData || p.inline_data);
    const data = img?.inlineData ?? img?.inline_data; if (!data) throw new Error(j.candidates?.[0]?.finishReason ? `Blocked: ${j.candidates[0].finishReason}` : 'No image returned');
    return fromB64(data.data, data.mimeType ?? data.mime_type);
  }
  // fal.ai
  const key = s.keys.fal; if (!key) throw new Error('Add your fal.ai API key in Settings.');
  const body: any = { prompt, aspect_ratio: aspect, num_images: 1, output_format: 'jpeg' };
  if (refs.length) {
    const urls = await Promise.all(refs.slice(0, 4).map(async b => `data:${b.type || 'image/jpeg'};base64,${await toB64(b)}`));
    if (/nano-banana|multi/.test(m.model)) body.image_urls = urls; else body.image_url = urls[0];
  }
  const r = await pfetch(s, `https://fal.run/${m.model}`, { method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await (await check(r)).json(); const url = j.images?.[0]?.url; if (!url) throw new Error('No image returned');
  if (url.startsWith('data:')) return (await fetch(url)).blob();
  return (await fetch(url)).blob();
}

/** Downscale reference photos before upload (saves tokens/bandwidth, keeps likeness). */
export async function shrink(b: Blob, max = 1280): Promise<Blob> {
  const bmp = await createImageBitmap(b); const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s)); c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
}
