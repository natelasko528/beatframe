// Programmatic in-browser export test through window.BeatFrameApp.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const S = '/tmp/claude-0/-home-claude/baa3f68c-b9c1-5e47-b667-5453a2736f3a/scratchpad';
const URL = process.env.URL || 'http://127.0.0.1:4174/';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const pg = await b.newPage(); pg.on('pageerror', e => console.log('PAGEERROR', e.message));
await pg.goto(URL); await pg.waitForSelector('.app');
await pg.setInputFiles('.drop input[type=file]', '/home/claude/az/assets/track.wav');
await pg.waitForFunction(() => !!window.BeatFrameApp.store.getState().project.analysis, null, { timeout: 120000 });
const lyr = fs.readFileSync('/home/claude/az/assets/lyrics.txt', 'utf8');
const res = await pg.evaluate(async (lyr) => {
  const { store, actions, exportVideo } = window.BeatFrameApp;
  store.getState().update(p => { p.lyricsRaw = lyr; p.meta.title = 'A to Z'; p.meta.artist = 'Tony Mack'; });
  const a = store.getState().project.analysis; actions.alignSpread(a.beats[4], a.dur - 4); actions.planVideo();
  const st = store.getState(); const p = structuredClone(st.project); p.analysis.dur = 6;   // 6-second test clip
  const t0 = performance.now();
  const out = await exportVideo(p, st.images, st.audioBuffer, { width: 1280, height: 720, quality: 'high' });
  const buf = new Uint8Array(await out.blob.arrayBuffer());
  return { ext: out.ext, ms: Math.round(performance.now() - t0), data: Array.from(buf) };
}, lyr);
fs.writeFileSync(`${S}/export_test.${res.ext}`, Buffer.from(res.data));
console.log('export', res.ext, res.data.length, 'bytes in', res.ms, 'ms');
await b.close();
