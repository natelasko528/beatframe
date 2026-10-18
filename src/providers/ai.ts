// One AI client for every AI stage, on whichever provider/model the user picks.
// Supports JSON replies and image inputs (vision) for OpenAI, Anthropic (Claude), Gemini and OpenRouter.
import { pfetch, type KeySettings } from './keys';

export type AiProvider = 'anthropic' | 'openai' | 'gemini' | 'openrouter';
export interface AiModel { provider: AiProvider; model: string }
export const AI_MODELS: Record<AiProvider, { label: string; models: string[] }> = {
  anthropic: { label: 'Claude', models: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'] },
  openai: { label: 'ChatGPT (OpenAI)', models: ['gpt-5-mini', 'gpt-5', 'gpt-4.1-mini'] },
  gemini: { label: 'Gemini', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'] },
  openrouter: { label: 'OpenRouter (any model)', models: ['anthropic/claude-sonnet-5.5', 'openai/gpt-5-mini', 'google/gemini-2.5-flash'] },
};
/** Rough USD per 1M tokens (input, output) for the cost estimate. */
export function tokenPrice(m: AiModel): [number, number] {
  const id = m.model.toLowerCase();
  if (/opus/.test(id)) return [15, 75]; if (/sonnet/.test(id)) return [3, 15]; if (/haiku/.test(id)) return [1, 5];
  if (/gpt-5-mini|4\.1-mini|4o-mini/.test(id)) return [0.25, 2]; if (/gpt-5|gpt-4\.1/.test(id)) return [1.25, 10];
  if (/flash-lite/.test(id)) return [0.1, 0.4]; if (/flash/.test(id)) return [0.3, 2.5]; if (/pro/.test(id)) return [1.25, 10];
  return [1, 5];
}
export function defaultAi(keys: KeySettings['keys']): AiModel | null {
  if (keys.anthropic) return { provider: 'anthropic', model: AI_MODELS.anthropic.models[0] };
  if (keys.openai) return { provider: 'openai', model: AI_MODELS.openai.models[0] };
  if (keys.gemini) return { provider: 'gemini', model: AI_MODELS.gemini.models[0] };
  if (keys.openrouter) return { provider: 'openrouter', model: AI_MODELS.openrouter.models[0] };
  return null;
}

export interface AiUsage { inTok: number; outTok: number; usd: number }
export const usage: AiUsage = { inTok: 0, outTok: 0, usd: 0 };
function track(m: AiModel, inTok: number, outTok: number) {
  const [pi, po] = tokenPrice(m); usage.inTok += inTok; usage.outTok += outTok; usage.usd += (inTok * pi + outTok * po) / 1e6;
}

const b64 = async (b: Blob) => { const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
async function fail(r: Response, who: string): Promise<never> { let t = ''; try { const j = await r.json(); t = j.error?.message || j.message || JSON.stringify(j); } catch { t = await r.text().catch(() => ''); } throw new Error(`${who} ${r.status}: ${t.slice(0, 240)}`); }

/** Ask the model for JSON. `images` are attached for vision stages. */
export async function askJSON<T = any>(keys: KeySettings, m: AiModel, system: string, user: string, images: Blob[] = [], maxTokens = 8000): Promise<T> {
  const imgs = await Promise.all(images.map(async b => ({ mime: b.type || 'image/jpeg', data: await b64(b) })));
  let text = '';
  if (m.provider === 'anthropic') {
    const content: any[] = [...imgs.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })), { type: 'text', text: user }];
    const r = await pfetch(keys, 'https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': keys.keys.anthropic || '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: m.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }) });
    if (!r.ok) await fail(r, 'Claude');
    const j = await r.json(); text = j.content.map((c: any) => c.text || '').join(''); track(m, j.usage?.input_tokens ?? 0, j.usage?.output_tokens ?? 0);
  } else if (m.provider === 'gemini') {
    const parts: any[] = [...imgs.map(i => ({ inlineData: { mimeType: i.mime, data: i.data } })), { text: user }];
    const r = await pfetch(keys, `https://generativelanguage.googleapis.com/v1beta/models/${m.model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys.keys.gemini || '' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens } }) });
    if (!r.ok) await fail(r, 'Gemini');
    const j = await r.json(); text = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') ?? ''; track(m, j.usageMetadata?.promptTokenCount ?? 0, j.usageMetadata?.candidatesTokenCount ?? 0);
  } else {
    const base = m.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : keys.openaiBase.replace(/\/$/, '');
    const key = m.provider === 'openrouter' ? keys.keys.openrouter : keys.keys.openai;
    const content: any[] = [...imgs.map(i => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } })), { type: 'text', text: user }];
    const r = await pfetch(keys, `${base}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: m.model, messages: [{ role: 'system', content: system }, { role: 'user', content }], response_format: { type: 'json_object' } }) });
    if (!r.ok) await fail(r, m.provider === 'openrouter' ? 'OpenRouter' : 'OpenAI');
    const j = await r.json(); text = j.choices?.[0]?.message?.content ?? ''; track(m, j.usage?.prompt_tokens ?? 0, j.usage?.completion_tokens ?? 0);
  }
  const a = text.indexOf('{'), z = text.lastIndexOf('}');
  if (a < 0 || z < a) throw new Error('The AI did not return JSON');
  try { return JSON.parse(text.slice(a, z + 1)); }
  catch { return JSON.parse(text.slice(a, z + 1).replace(/,\s*([}\]])/g, '$1')); }   // tolerate trailing commas
}

/** Gemini can listen: timestamped lyric lines straight from the audio (code then times each word). */
export async function geminiLyrics(keys: KeySettings, model: string, audio: Blob, hint: string): Promise<{ t: number; e: number; text: string }[]> {
  const data = await b64(audio);
  const r = await pfetch(keys, `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys.keys.gemini || '' },
    body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: audio.type || 'audio/mpeg', data } }, { text: `Transcribe every sung or rapped line of this song with precise timestamps.${hint ? ` The official lyrics (use their spelling) are:\n${hint}\n` : ''}
Reply JSON: {"lines":[{"start":"m:ss.s","end":"m:ss.s","text":"..."}]} — one entry per vocal line in order, including repeats and ad-lib lines; no section labels.` }] }], generationConfig: { responseMimeType: 'application/json' } }) });
  if (!r.ok) await fail(r, 'Gemini');
  const j = await r.json(); const txt = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') ?? '{}';
  const toS = (v: any) => typeof v === 'number' ? v : String(v).split(':').reduce((a, x) => a * 60 + parseFloat(x), 0);
  return (JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)).lines ?? []).map((l: any) => ({ t: toS(l.start), e: toS(l.end), text: String(l.text) }));
}
