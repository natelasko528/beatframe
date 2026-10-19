// Render chosen frames of a project with the engine bundle (same as CLI) and save PNGs. node scripts/frames.mjs project.json outdir t1 t2 ...
import { chromium } from 'playwright-core'; import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [pj, out, ...ts] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const engine = path.join(ROOT, 'dist-engine', 'beatframe-engine.js');
const page = `<!doctype html><body style="margin:0"><canvas id=c width=1920 height=1080></canvas><script src="/engine.js"></script>`;
const srv = http.createServer((q, r) => { if (q.url === '/') return r.end(page); if (q.url === '/engine.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return fs.createReadStream(engine).pipe(r); } if (q.url === '/p.json') return fs.createReadStream(pj).pipe(r); r.writeHead(404); r.end(); });
await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await b.newPage(); pg.on('console', m => console.log('page:', m.text()));
await pg.goto(`http://127.0.0.1:${srv.address().port}/`);
await pg.evaluate(async () => { const p = await (await fetch('/p.json')).json(); const imgs = {}, clips = {}; await Promise.all(p.assets.filter(x => x.url).map(async x => { const b = await (await fetch(x.url)).blob(); if (x.kind === 'clip') clips[x.id] = b; else imgs[x.id] = await createImageBitmap(b); })); window.R = new window.BeatFrame.Renderer(document.getElementById('c'), { ...p, width: 1920, height: 1080 }, imgs); if (Object.keys(clips).length) window.R.setClips(new window.BeatFrame.ClipBank(clips)); });
for (const t of ts) {
  const d = await pg.evaluate(async t => { const t0 = performance.now(); await window.R.prepare(t); window.R.renderAt(t); const ms = performance.now() - t0; return { ms, gl: !!window.R.motion, url: document.getElementById('c').toDataURL('image/png') }; }, +t);
  fs.writeFileSync(`${out}/t${t}.png`, Buffer.from(d.url.split(',')[1], 'base64')); console.log(t, 'gl', d.gl, Math.round(d.ms) + 'ms');
}
await b.close(); srv.close();
