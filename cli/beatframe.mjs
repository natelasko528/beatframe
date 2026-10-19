#!/usr/bin/env node
// BeatFrame CLI — render a saved project (.beatframe.json) to MP4 without the web app.
// Same deterministic renderer as the studio. Needs Chromium (Playwright) and ffmpeg on PATH.
//   beatframe render project.beatframe.json --audio song.mp3 --out video.mp4 [--res 1080] [--workers 2] [--crf 17]
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); const cmd = args[0];
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
if (cmd !== 'render' || !args[1]) { console.log('usage: beatframe render <project.beatframe.json> --audio <song> --out <video.mp4> [--res 480|720|1080|1440|2160] [--workers 2] [--crf 17] [--from 0 --to <sec>]'); process.exit(1); }

const projectPath = path.resolve(args[1]), audio = opt('audio'), out = path.resolve(opt('out', 'video.mp4'));
const assetDir = path.resolve(opt('assets', path.dirname(projectPath)));   // asset urls of the form "file:NAME" are read from here (keeps big clips out of the JSON)
const res = +opt('res', 1080); if (![480, 720, 1080, 1440, 2160].includes(res)) { console.error('--res must be 480, 720, 1080, 1440 or 2160 (4K)'); process.exit(1); }
const workers = Math.max(1, +opt('workers', Math.max(1, Math.min(4, os.cpus().length - 1)))), crf = opt('crf', '17');
const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
const vertical = project.height > project.width; const long = Math.round(res * 16 / 9 / 2) * 2;
const W = vertical ? res : long, H = vertical ? long : res, fps = project.fps || 30;
const dur = project.analysis?.dur; if (!dur) { console.error('Project has no analysis (load the song in the studio first).'); process.exit(1); }
const f0 = Math.round(+opt('from', 0) * fps), f1 = Math.round(+opt('to', dur) * fps);

const engine = path.join(ROOT, 'dist-engine', 'beatframe-engine.js');
const newest = d => fs.readdirSync(d, { withFileTypes: true }).reduce((m, e) => Math.max(m, e.isDirectory() ? newest(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).mtimeMs), 0);
if (!fs.existsSync(engine) || fs.statSync(engine).mtimeMs < newest(path.join(ROOT, 'src', 'engine'))) { console.log('Building engine bundle…'); execFileSync('npx', ['vite', 'build', '-c', 'vite.engine.config.ts'], { cwd: ROOT, stdio: 'inherit' }); }

// tiny static server: page + fonts + engine + project
const fontCss = ['@fontsource/anton/400.css', '@fontsource/permanent-marker/400.css', '@fontsource/oswald/400.css', '@fontsource/oswald/600.css', '@fontsource/bebas-neue/400.css', '@fontsource/playfair-display/900.css', '@fontsource/playfair-display/900-italic.css', '@fontsource/dm-mono/500.css', '@fontsource/montserrat/800.css', '@fontsource/caveat/700.css', '@fontsource/cinzel/700.css', '@fontsource/space-grotesk/700.css'];
const page = `<!doctype html><meta charset=utf-8>${fontCss.map(f => `<link rel=stylesheet href="/node_modules/${f}">`).join('')}<body style="margin:0;background:#000"><canvas id=c width=${W} height=${H}></canvas><script src="/engine.js"></script>`;
const server = http.createServer((req, r) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(page); }
  if (u === '/engine.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return fs.createReadStream(engine).pipe(r); }
  if (u === '/project.json') { r.writeHead(200, { 'content-type': 'application/json' }); return fs.createReadStream(projectPath).pipe(r); }
  if (u.startsWith('/asset/')) { const f = path.join(assetDir, path.basename(u)); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200); return fs.createReadStream(f).pipe(r); }
  const f = path.join(ROOT, u); if (!f.startsWith(path.join(ROOT, 'node_modules')) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': f.endsWith('.css') ? 'text/css' : f.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok)); const port = server.address().port;

const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers') ? undefined : undefined);
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-accelerated-2d-canvas'] }).catch(e => { console.error('Could not start Chromium. Run `npx playwright install chromium` or set CHROMIUM_PATH.\n' + e.message); process.exit(1); });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beatframe-'));
const total = f1 - f0, per = Math.ceil(total / workers); let doneFrames = 0; const t0 = Date.now();
async function setup(pg) {
  return pg.evaluate(async ([W, H]) => {
    await document.fonts.ready;
    await Promise.all(['400 40px Anton', '400 40px "Permanent Marker"', '600 40px Oswald', '400 40px Oswald', '400 40px "Bebas Neue"', '900 40px "Playfair Display"', 'italic 900 40px "Playfair Display"', '500 40px "DM Mono"', '800 40px Montserrat', '700 40px Caveat', '700 40px Cinzel', '700 40px "Space Grotesk"'].map(f => document.fonts.load(f)));
    const p = await (await fetch('/project.json')).json(); const imgs = {};
    const clips = {};
    await Promise.all(p.assets.filter(x => x.url).map(async x => { const b = await (await fetch(x.url.startsWith('file:') ? '/asset/' + encodeURIComponent(x.url.slice(5)) : x.url)).blob(); if (x.kind === 'clip') clips[x.id] = b; else imgs[x.id] = await createImageBitmap(b); }));
    window.R = new window.BeatFrame.Renderer(document.getElementById('c'), { ...p, width: W, height: H }, imgs);
    if (Object.keys(clips).length) window.R.setClips(new window.BeatFrame.ClipBank(clips));
  }, [W, H]);
}
async function work(w) {
  const a = f0 + w * per, b = Math.min(f1, a + per); if (a >= b) return null;
  const pg = await browser.newPage({ viewport: { width: W, height: H } });
  await pg.goto(`http://127.0.0.1:${port}/`);
  await setup(pg);
  const seg = path.join(tmp, `seg${w}.mp4`);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', crf, '-pix_fmt', 'yuv420p', seg], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = a; f < b; f++) {
    if ((f - a) > 0 && (f - a) % 1500 === 0) { await pg.goto(`http://127.0.0.1:${port}/`); await setup(pg); }   // fresh page every ~50s of video keeps memory flat
    const d = await pg.evaluate(async t => { await window.R.prepare(t); window.R.renderAt(t); return document.getElementById('c').toDataURL('image/jpeg', 0.94); }, f / fps);
    if (!ff.stdin.write(Buffer.from(d.split(',')[1], 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
    if (++doneFrames % 60 === 0) { const el = (Date.now() - t0) / 1000; process.stdout.write(`\r${(100 * doneFrames / total).toFixed(1)}%  ${(doneFrames / el).toFixed(1)} fps  eta ${Math.round((total - doneFrames) / (doneFrames / el))}s   `); }
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await pg.close(); return seg;
}
const segs = (await Promise.all(Array.from({ length: workers }, (_, w) => work(w)))).filter(Boolean);
await browser.close(); server.close();
const list = path.join(tmp, 'list.txt'); fs.writeFileSync(list, segs.map(s => `file '${s}'`).join('\n'));
const mux = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
if (audio) mux.push('-ss', String(f0 / fps), '-i', path.resolve(audio), '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '320k', '-shortest');
mux.push('-c:v', 'copy', '-movflags', '+faststart', out);
execFileSync('ffmpeg', mux, { stdio: 'inherit' }); fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nDone: ${out}  (${W}x${H}, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
