import { chromium } from 'playwright-core';
import fs from 'node:fs';
const S = '/tmp/claude-0/-home-claude/baa3f68c-b9c1-5e47-b667-5453a2736f3a/scratchpad';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const pg = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = []; pg.on('console', m => logs.push(m.type() + ': ' + m.text())); pg.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await pg.goto('http://127.0.0.1:4174/'); await pg.waitForSelector('.app');
await pg.screenshot({ path: `${S}/ui0.png` });
// 1 song
await pg.setInputFiles('.drop input[type=file]', '/home/claude/az/assets/track.wav');
try { await pg.waitForFunction(() => /BPM/.test(document.querySelector('.drop span')?.textContent || ''), null, { timeout: 120000 }); } catch (e) { console.log('STATUS', await pg.textContent('.status'), logs.slice(-5)); throw e; }
console.log('song:', await pg.textContent('.drop span'));
await pg.fill('label.field:has-text("Artist") input', 'Tony Mack');
await pg.fill('label.field:has-text("Title") input', 'A to Z');
// 2 lyrics
await pg.click('.steps button:has-text("Lyrics")');
await pg.fill('textarea', fs.readFileSync('/home/claude/az/assets/lyrics.txt', 'utf8'));
await pg.click('button:has-text("Spread evenly")');
await pg.waitForSelector('ol.lines li');
console.log('lines:', await pg.locator('ol.lines li').count());
// 3 look -> alphabet
await pg.click('.steps button:has-text("Look")'); await pg.click('.presets button:has-text("Alphabet Hustler")');
// 4 scenes -> plan
await pg.click('.steps button:has-text("Scenes")'); await pg.click('button:has-text("Plan the edit")');
await pg.waitForSelector('ul.scenes li'); console.log('scenes:', await pg.locator('ul.scenes li').count(), '| status:', await pg.textContent('.status'));
// upload a few images to scenes
const imgs = ['A', 'B', 'C', 'H1', 'H2', 'T', 'OPEN', 'M'];
const ups = pg.locator('ul.scenes li label.btn input[type=file]');
for (let i = 0; i < Math.min(8, await ups.count()); i++) await ups.nth(i).setInputFiles(`/home/claude/az/gen/${imgs[i]}.png`);
await pg.waitForTimeout(1500);
// seek timeline + screenshot
await pg.click('.steps button:has-text("Edit")');
const tl = await pg.locator('.timeline-scroll').boundingBox(); await pg.mouse.click(tl.x + tl.width * 0.17, tl.y + 40);
await pg.waitForTimeout(800); await pg.screenshot({ path: `${S}/ui1.png` });
await pg.mouse.click(tl.x + tl.width * 0.064, tl.y + 40); await pg.waitForTimeout(500); await pg.screenshot({ path: `${S}/ui2.png` });
// export capability
const can = await pg.evaluate(async () => { const m = await import('/node_modules/.vite/none').catch(() => null); return { VideoEncoder: 'VideoEncoder' in window, avc: await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 1280, height: 720 }).then(r => r.supported).catch(e => String(e)), vp9: await VideoEncoder.isConfigSupported({ codec: 'vp09.00.10.08', width: 1280, height: 720 }).then(r => r.supported), aac: 'AudioEncoder' in window ? await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 }).then(r => r.supported) : false, opus: await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 }).then(r => r.supported) }; });
console.log('codecs:', JSON.stringify(can));
fs.writeFileSync(`${S}/smoke.log`, logs.join('\n')); console.log('console lines', logs.length, logs.filter(l => /error/i.test(l)).slice(0, 8));
await b.close();
