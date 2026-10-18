import fs from 'node:fs'; import { execFileSync } from 'node:child_process';
import { analyze } from '../src/engine/analysis';
import { parseLyrics, alignLyrics, linesFromTranscript } from '../src/engine/align';
import { planSections, planLetters, planSigns, planEdit } from '../src/engine/planner';
import { autoBrief, briefRequest, applyBrief, capScenes } from '../src/engine/director';
import { promptForScene } from '../src/engine/prompts';
import { newProject } from '../src/store';
const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', '/home/claude/az/assets/track.wav', '-ac', '1', '-ar', '22050', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const A = analyze(new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4), 22050);
const asr = JSON.parse(fs.readFileSync('/home/claude/az/assets/asr.json', 'utf8')).flatMap((s: any) => s.words.map((w: any) => ({ w: w.w, s: w.s, e: w.e })));
for (const withLyrics of [true, false]) {
  const p = newProject(); p.meta.title = 'A to Z'; p.meta.artist = 'Tony Mack'; p.analysis = A;
  p.lines = withLyrics ? alignLyrics(parseLyrics(fs.readFileSync('/home/claude/az/assets/lyrics.txt', 'utf8')), asr, A.dur, { dropUnsung: true }) : linesFromTranscript(asr, A.dur);
  const sd = planSections(p.lines, A.dur); p.sections = sd.sections; p.drops = sd.drops; p.letters = planLetters(p.lines); p.signs = planSigns(p.lines);
  const b = autoBrief(p); p.brief = b; p.mood = b.mood; p.plan.mode = b.cutting;
  const pe = planEdit(p, b.mood, b.city); p.shots = pe.shots; p.scenes = pe.scenes; const before = p.scenes.length; capScenes(p, 24);
  applyBrief(p, b); p.scenes.forEach(s => (s.prompt = promptForScene(p, s)));
  const req = briefRequest(p, b);
  console.log(`\n== ${withLyrics ? 'with pasted lyrics' : 'transcript only'}: lines ${p.lines.length}, hooks ${p.lines.filter(l => l.style === 'hook').length}, letters ${p.letters.length}, sections ${p.sections.map(s => s[0]).join('>')}`);
  console.log('brief:', JSON.stringify({ ...b, sceneIdeas: undefined, definition: b.definition }));
  console.log(`scenes ${before} -> ${p.scenes.length}; shots ${p.shots.length}; shots pointing at missing scenes: ${p.shots.filter(s => s.img && !p.scenes.find(x => x.id === s.img)).length}`);
  console.log(`AI brief request ≈ ${Math.round((req.system.length + req.user.length) / 4)} tokens in`);
  if (!withLyrics) console.log('first lines:', p.lines.slice(0, 6).map(l => `[${l.sec}] ${l.text}`).join(' | '));
  console.log('sample prompt:', p.scenes[3].prompt.slice(0, 300));
}
