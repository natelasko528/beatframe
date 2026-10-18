// End-to-end walk of the new flow (no API key: every AI stage must fall back to code). Usage: node scripts/walk.mjs <url> <song> <outdir> [lyrics]
import { chromium } from 'playwright-core'; import fs from 'node:fs';
const [url, song, out, lyr] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
pg.on('pageerror', e => console.log('PAGEERROR', e.message)); pg.on('console', m => m.type() === 'error' && console.log('CONSOLE', m.text().slice(0, 200)));
await pg.goto(url); await pg.waitForSelector('.start');
await pg.screenshot({ path: `${out}/1_start.png` });
await pg.setInputFiles('.drop input[type=file]', song);
await pg.fill('input[placeholder="Optional"]', 'Test Artist');
if (lyr) { await pg.click('.disclose'); await pg.fill('.more textarea >> nth=0', fs.readFileSync(lyr, 'utf8')); }
await pg.screenshot({ path: `${out}/2_start_filled.png` });
await pg.click('.cta'); await pg.waitForSelector('.producing'); await pg.waitForTimeout(4000);
await pg.screenshot({ path: `${out}/3_producing.png` });
const t0 = Date.now();
await pg.waitForSelector('.studio, .prod-err', { timeout: 600000 });
console.log('produce secs', ((Date.now() - t0) / 1000).toFixed(0));
if (await pg.$('.prod-err')) { console.log('ERR', await pg.textContent('.prod-err')); await pg.screenshot({ path: `${out}/3b_err.png` }); }
else {
  await pg.waitForTimeout(1500); await pg.screenshot({ path: `${out}/4_studio.png` });
  for (const [i, tab] of ['Scenes', 'Lyrics', 'Artist', 'Export'].entries()) { const btn = pg.locator(`.tabs button:has-text("${tab}")`); if (await btn.count()) { await btn.click(); await pg.waitForTimeout(500); await pg.screenshot({ path: `${out}/5_${i}_${tab}.png` }); } else console.log('no tab', tab); }
  const s = await pg.evaluate(() => { const p = window.BeatFrameApp.store.getState().project; return { scenes: p.scenes.length, shots: p.shots.length, lines: p.lines.length, mood: p.style?.mood, concept: p.direction?.concept?.slice(0, 120), bpm: p.analysis?.bpm, key: p.analysis?.features?.key }; });
  console.log(JSON.stringify(s));
  await pg.setViewportSize({ width: 390, height: 844 }); await pg.waitForTimeout(500); await pg.screenshot({ path: `${out}/6_mobile_studio.png`, fullPage: false });
}
await b.close();
