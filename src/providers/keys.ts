// Bring-your-own-key vault. Keys live only in this browser (localStorage, or sessionStorage when "remember" is off),
// optionally encrypted with a passphrase (AES-GCM, PBKDF2 250k). They are sent only to the provider you call.
export type ProviderId = 'openai' | 'gemini' | 'fal' | 'anthropic' | 'openrouter';
export interface KeySettings { keys: Partial<Record<ProviderId, string>>; useProxy: boolean; openaiBase: string }
const LS = 'beatframe.keys.v1';
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(u as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function derive(pass: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt as BufferSource, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export const DEFAULT_KEYS: KeySettings = { keys: {}, useProxy: false, openaiBase: 'https://api.openai.com/v1' };
export function loadPlain(): KeySettings | null {
  const raw = localStorage.getItem(LS) ?? sessionStorage.getItem(LS); if (!raw) return null;
  try { const o = JSON.parse(raw); return o.cipher ? null : { ...DEFAULT_KEYS, ...o }; } catch { return null; }
}
export function isLocked(): boolean { try { return !!JSON.parse(localStorage.getItem(LS) || '{}').cipher; } catch { return false; } }
export async function unlock(pass: string): Promise<KeySettings> {
  const o = JSON.parse(localStorage.getItem(LS)!); const key = await derive(pass, unb64(o.salt));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(o.iv) as BufferSource }, key, unb64(o.cipher) as BufferSource);
  return { ...DEFAULT_KEYS, ...JSON.parse(dec.decode(plain)) };
}
export async function save(s: KeySettings, opts: { remember: boolean; passphrase?: string }) {
  localStorage.removeItem(LS); sessionStorage.removeItem(LS);
  const store = opts.remember ? localStorage : sessionStorage;
  if (opts.passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), key = await derive(opts.passphrase, salt);
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, enc.encode(JSON.stringify(s)));
    store.setItem(LS, JSON.stringify({ salt: b64(salt), iv: b64(iv), cipher: b64(cipher) }));
  } else store.setItem(LS, JSON.stringify(s));
}
export function forget() { localStorage.removeItem(LS); sessionStorage.removeItem(LS); }

/** fetch that optionally routes through the stateless /api/proxy (for providers without browser CORS). */
export async function pfetch(s: KeySettings, url: string, init: RequestInit): Promise<Response> {
  if (!s.useProxy) return fetch(url, init);
  return fetch('/api/proxy', { ...init, headers: { ...(init.headers as any), 'x-target-url': url } });
}
