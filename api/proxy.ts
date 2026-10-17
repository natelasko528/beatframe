// Stateless pass-through for providers that block browser CORS. Never logs or stores keys or bodies.
export const config = { runtime: 'edge' };
const ALLOW = ['api.openai.com', 'generativelanguage.googleapis.com', 'fal.run', 'queue.fal.run', 'api.anthropic.com', 'openrouter.ai'];
export default async function handler(req: Request) {
  const target = req.headers.get('x-target-url');
  if (!target) return new Response('missing x-target-url', { status: 400 });
  const u = new URL(target); if (u.protocol !== 'https:' || !ALLOW.includes(u.hostname)) return new Response('host not allowed', { status: 403 });
  const headers = new Headers(req.headers); ['x-target-url', 'host', 'cookie', 'origin', 'referer'].forEach(h => headers.delete(h));
  const r = await fetch(u, { method: req.method, headers, body: req.method === 'GET' ? undefined : req.body, // @ts-ignore
    duplex: 'half' });
  const out = new Headers(r.headers); out.delete('set-cookie');
  return new Response(r.body, { status: r.status, headers: out });
}
