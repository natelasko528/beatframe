// Build the BeatFrame project: direction + hot words + scene images (+ alias table so lines share images), then save it.
// Usage: node tools/build.mjs --song song.wav --lyrics lyrics.txt --words words.json --title T --artist A
//          --direction direction.json --images dir_of_SXX.jpg [--alias alias.json] [--hot "w1,w2"] [--fx fx.json] [--depth] [--strength 1] --out project.beatframe.json
//   fx.json: {"S07": ["snow"], "S20": ["rays","flare"]}  (rain, snow, embers, dust, rays, flare, petals, sparks)
import { chromium } from 'playwright-core'; import fs from 'node:fs'; import path from 'node:path';
const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; }, flag = k => a.includes('--' + k);
const fxMap = opt('fx') ? JSON.parse(fs.readFileSync(opt('fx'), 'utf8')) : {};
const dir = JSON.parse(fs.readFileSync(opt('direction'), 'utf8')), alias = opt('alias') ? JSON.parse(fs.readFileSync(opt('alias'), 'utf8')) : {};
const imgs = fs.readdirSync(opt('images')).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).map(f => path.join(opt('images'), f));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const pg = await b.newPage(); pg.on('pageerror', e => console.log('PAGEERROR', e.message));
await pg.goto(opt('url', 'http://127.0.0.1:4175/')); await pg.waitForSelector('.start');
await pg.setInputFiles('.drop input[type=file]', opt('song'));
await pg.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.id = 'imgs'; document.body.appendChild(i); });
await pg.setInputFiles('#imgs', imgs);
const r = await pg.evaluate(async ({ lyr, words, dir, alias, title, artist, hot, depth, fxMap, strength }) => {
  const { store, actions } = window.BeatFrameApp; const S = store.getState;
  await actions.loadAudio(document.querySelector('.drop input').files[0]);
  S().update(p => { p.lyricsRaw = lyr; p.meta.title = title; p.meta.artist = artist; p.plan.sceneBudget = 999;
    p.reading = { genre: '', subgenre: '', story: '', themes: [], imagery: [], places: [], characters: [artist], hotWords: hot, mood: '', energyArc: '' }; });
  actions.alignWords(words); actions.applyDirection(dir, true); actions.replan();
  S().update(p => { p.shots.forEach(s => { if (alias[s.img]) s.img = alias[s.img]; }); p.scenes = p.scenes.filter(s => !alias[s.id]); });
  for (const f of Array.from(document.getElementById('imgs').files)) { const id = f.name.replace(/\.[^.]+$/, ''); if (S().project.scenes.find(s => s.id === id)) await actions.addAsset(f, 'image', id, f.name); }
  S().update(p => p.scenes.forEach(s => { if (S().images[s.id]) s.status = 'done'; }));
  S().update(p => { p.scenes.forEach(s => { if (fxMap[s.id]) s.fx = fxMap[s.id]; }); if (strength) p.style.motion.depth = strength; });
  if (depth) await actions.addDepth();
  const p = S().project, missing = p.scenes.filter(s => !S().images[s.id]).map(s => s.id);
  return { scenes: p.scenes.length, shots: p.shots.length, missing, json: await (await actions.exportProjectFile()).text() };
}, { lyr: fs.readFileSync(opt('lyrics'), 'utf8'), words: JSON.parse(fs.readFileSync(opt('words'), 'utf8')), dir, alias, title: opt('title', 'Untitled'), artist: opt('artist', ''),
     hot: (opt('hot', '') || '').split(',').map(s => s.trim()).filter(Boolean), depth: flag('depth'), fxMap, strength: +opt('strength', 0) });
fs.writeFileSync(opt('out', 'project.beatframe.json'), r.json);
console.log(`${r.scenes} scenes, ${r.shots} shots, missing images: ${r.missing.join(', ') || 'none'}${flag('depth') ? ' (depth maps added)' : ''}`);
await b.close();
