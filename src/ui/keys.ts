import type { ProviderId } from '../providers/keys';
/** Recognise which service a pasted key belongs to. */
export function detectProvider(key: string): ProviderId | null {
  const k = key.trim();
  if (/^sk-ant-/.test(k)) return 'anthropic';
  if (/^sk-or-/.test(k)) return 'openrouter';
  if (/^sk-/.test(k)) return 'openai';
  if (/^AIza[0-9A-Za-z_-]{20,}$/.test(k)) return 'gemini';
  if (/^[0-9a-f-]{20,}:[0-9a-f]{16,}$/i.test(k)) return 'fal';
  return null;
}
export const PROVIDER_INFO: Record<ProviderId, { name: string; images: boolean; getKey: string }> = {
  anthropic: { name: 'Claude', images: false, getKey: 'https://console.anthropic.com/settings/keys' },
  openai: { name: 'ChatGPT / OpenAI', images: true, getKey: 'https://platform.openai.com/api-keys' },
  gemini: { name: 'Gemini', images: true, getKey: 'https://aistudio.google.com/apikey' },
  openrouter: { name: 'OpenRouter', images: false, getKey: 'https://openrouter.ai/keys' },
  fal: { name: 'fal.ai', images: true, getKey: 'https://fal.ai/dashboard/keys' },
};
