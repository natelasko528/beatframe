// Optional: polish template scene prompts with any LLM the user picks. The app works fully without this.
import { pfetch, type KeySettings } from './keys';
export interface LlmModel { provider: 'openai' | 'anthropic' | 'gemini' | 'openrouter'; model: string }
export const LLM_SUGGESTIONS: Record<LlmModel['provider'], string[]> = {
  openai: ['gpt-5-mini', 'gpt-4.1-mini'], anthropic: ['claude-haiku-5-5', 'claude-sonnet-5-5'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'], openrouter: ['openai/gpt-4.1-mini', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-flash'],
};

export async function chat(s: KeySettings, m: LlmModel, system: string, user: string, json = false): Promise<string> {
  if (m.provider === 'anthropic') {
    const r = await pfetch(s, 'https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': s.keys.anthropic || '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: m.model, max_tokens: 8000, system, messages: [{ role: 'user', content: user }] }) });
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`); const j = await r.json(); return j.content.map((c: any) => c.text || '').join('');
  }
  if (m.provider === 'gemini') {
    const r = await pfetch(s, `https://generativelanguage.googleapis.com/v1beta/models/${m.model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.keys.gemini || '' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ parts: [{ text: user }] }], ...(json ? { generationConfig: { responseMimeType: 'application/json' } } : {}) }) });
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 200)}`); const j = await r.json(); return j.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') ?? '';
  }
  const base = m.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : s.openaiBase.replace(/\/$/, '');
  const key = m.provider === 'openrouter' ? s.keys.openrouter : s.keys.openai;
  const r = await pfetch(s, `${base}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: m.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], ...(json ? { response_format: { type: 'json_object' } } : {}) }) });
  if (!r.ok) throw new Error(`${m.provider} ${r.status}: ${(await r.text()).slice(0, 200)}`); const j = await r.json(); return j.choices?.[0]?.message?.content ?? '';
}

/** Rewrite scene prompts into richer, varied visual directions. Returns prompts in the same order. */
export async function polishPrompts(s: KeySettings, m: LlmModel, ctx: { title: string; artist: string; mood: string; avatar: string; city: string }, scenes: { id: string; prompt: string }[]): Promise<Record<string, string>> {
  const system = 'You are a music video director writing image-generation prompts. Keep each prompt photoreal, cinematic, 16:9, varied in location and camera angle, and keep any instruction about preserving the main character\'s identity from reference photos. Never add on-screen text. Reply with JSON only: {"<id>": "<prompt>", ...}.';
  const user = `Song: "${ctx.title}" by ${ctx.artist}. City/setting: ${ctx.city || 'any'}. Mood: ${ctx.mood}. Main character: ${ctx.avatar || 'see references'}.\nRewrite these scene prompts so the video has variety and tells the story of the lyrics:\n${JSON.stringify(Object.fromEntries(scenes.map(x => [x.id, x.prompt])))}`;
  const txt = await chat(s, m, system, user); const json = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1);
  return JSON.parse(json);
}

/** One call: the creative director's ideas as JSON. ~4–8k tokens total, a fraction of a cent on small models. */
export async function creativeBrief(s: KeySettings, m: LlmModel, req: { system: string; user: string }): Promise<any> {
  const txt = await chat(s, m, req.system, req.user, true);
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('The model did not return a brief');
  return JSON.parse(txt.slice(a, b + 1));
}

/** Pick sensible default models from whichever keys the user added. */
export function autoModels(keys: KeySettings['keys']) {
  return {
    llm: keys.openai ? { provider: 'openai', model: 'gpt-5-mini' } as LlmModel : keys.gemini ? { provider: 'gemini', model: 'gemini-2.5-flash' } as LlmModel
      : keys.anthropic ? { provider: 'anthropic', model: 'claude-haiku-5-5' } as LlmModel : keys.openrouter ? { provider: 'openrouter', model: 'google/gemini-2.5-flash' } as LlmModel : null,
  };
}
