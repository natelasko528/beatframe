// Load a song into BeatFrame (headless), time the lyrics against a transcript, plan the beat-cut edit, dump scenes.
// Usage: node tools/plan.mjs --song song.wav --lyrics lyrics.txt --words words.json --title T --artist A --out plan.json [--url http://127.0.0.1:4175/]
import { chromium } from 'playwright-core'; import fs from 'node:fs';
const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const pg = await b.newPage(); pg.on('pageerror', e => console.log('PAGEERROR', e.message));
await pg.goto(opt('url', 'http://127.0.0.1:4175/')); await pg.waitForSelector('.start');
await pg.setInputFiles('.drop input[type=file]', opt('song'));
const out = await pg.evaluate(async ({ lyr, words, title, artist }) => {
  const { store, actions } = window.BeatFrameApp; const S = store.getState;
  await actions.loadAudio(document.querySelector('.drop input').files[0]);
  S().update(p => { p.lyricsRaw = lyr; p.meta.title = title; p.meta.artist = artist; p.plan.sceneBudget = 999; });
  actions.alignWords(words); actions.replan();
  const p = S().project;
  return { tempo: p.analysis.tempo, features: p.analysis.features, sections: p.sections,
    lines: p.lines.map(l => ({ sec: l.sec, t: +l.start.toFixed(2), text: l.text, matched: l.words.filter(w => w.m).length + '/' + l.words.length })),
    scenes: p.scenes.map(s => ({ id: s.id, lyric: s.lyric, shots: p.shots.filter(x => x.img === s.id).map(x => +x.from.toFixed(1)) })) };
}, { lyr: fs.readFileSync(opt('lyrics'), 'utf8'), words: JSON.parse(fs.readFileSync(opt('words'), 'utf8')), title: opt('title', 'Untitled'), artist: opt('artist', '') });
fs.writeFileSync(opt('out', 'plan.json'), JSON.stringify(out, null, 1));
console.log(Math.round(out.tempo), 'BPM', out.features?.key, out.features?.mode, '|', out.lines.length, 'lines |', out.scenes.length, 'scenes');
for (const s of out.scenes) console.log(s.id, s.shots.join(','), '|', s.lyric);
await b.close();
