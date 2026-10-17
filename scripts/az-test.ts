// End-to-end engine test on real data (A to Z): JS analysis vs librosa, lyric alignment, planning -> project file for the CLI.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { analyze } from '../src/engine/analysis';
import { parseLyrics, alignLyrics } from '../src/engine/align';
import { planSections, planLetters, planSigns, planEdit } from '../src/engine/planner';
import { PRESETS } from '../src/engine/styles';
import type { Project } from '../src/engine/types';

const AZ = '/home/claude/az';
// decode audio to mono 22.05k float32 via ffmpeg
const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', `${AZ}/assets/track.wav`, '-ac', '1', '-ar', '22050', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
let t = Date.now(); const A = analyze(samples, 22050); console.log('analysis', Date.now() - t, 'ms', 'tempo', A.tempo, 'beats', A.beats.length, 'kicks', A.kicks.length);
const ref = JSON.parse(fs.readFileSync(`${AZ}/assets/analysis.json`, 'utf8'));
const near = (a: number[], b: number[], tol: number) => a.filter(x => b.some(y => Math.abs(x - y) < tol)).length / a.length;
console.log('librosa tempo', ref.tempo.toFixed(2), '| beats within 70ms of librosa:', (100 * near(A.beats, ref.beats, 0.07)).toFixed(1) + '%');

const asr = JSON.parse(fs.readFileSync(`${AZ}/assets/asr.json`, 'utf8')).flatMap((s: any) => s.words.map((w: any) => ({ w: w.w, s: w.s, e: w.e })));
const parsed = parseLyrics(fs.readFileSync(`${AZ}/assets/lyrics.txt`, 'utf8'));
const lines = alignLyrics(parsed, asr, A.dur, { dropUnsung: true });
const tot = lines.reduce((a, l) => a + l.words.length, 0), m = lines.reduce((a, l) => a + l.words.filter(w => w.m).length, 0);
console.log('lines', lines.length, 'matched', m, '/', tot);
const py = JSON.parse(fs.readFileSync(`${AZ}/assets/lines.json`, 'utf8'));
const common = lines.filter(l => py.some((q: any) => q.text === l.text));
const diffs = common.map(l => Math.abs(l.start - py.find((q: any) => q.text === l.text && Math.abs(q.start - l.start) < 5)?.start ?? 99));
console.log('line-start agreement with the Python aligner: median', diffs.sort((a, b) => a - b)[diffs.length >> 1].toFixed(3), 's');

const { sections, drops } = planSections(lines, A.dur);
const p: Project = { version: 1, meta: { title: 'A to Z', artist: 'Tony Mack', tagline: 'the Alphabet Hustler', definition: ['al·pha·bet hus·tler', '/ ˈalfəˌbet ˈhəs(ə)lər /   noun', '1.  One who runs the whole alphabet, A to Z, and wins every letter.', '2.  Tony Mack.  See also: MILWAUKEE.'] },
  width: 1920, height: 1080, fps: 30, analysis: A, lyricsRaw: '', lines, sections, drops, letters: planLetters(lines), signs: planSigns(lines, []),
  shots: [], scenes: [], assets: [], style: structuredClone(PRESETS.alphabet), avatar: { description: '', refIds: [] }, plan: { mode: 'alphabet', beatsPerShot: 4 } };
const { shots, scenes } = planEdit(p, 'After-dark luxury', 'Milwaukee, Wisconsin');
p.shots = shots; p.scenes = scenes;
console.log('sections', sections.map(s => s[0] + '@' + s[1]).join(' '), '\nletters', p.letters.length, 'signs', p.signs.map(s => s.text).join(', '), '\nshots', shots.length, 'scenes', scenes.length);
// map scenes to the already-generated A-to-Z images so the CLI can render a real test
const pool = fs.readdirSync(`${AZ}/public/img`).filter(f => /^(H\d|V2A|V2B|V3\w|BR|OUT|OPEN|T|M|O|W)\.jpg$/.test(f));
let k = 0;
for (const sc of scenes) {
  const letter = p.shots.find(s => s.img === sc.id && s.letter)?.letter ?? (p.shots.find(s => s.img === sc.id && s.flash) ? null : null);
  const file = letter && fs.existsSync(`${AZ}/public/img/${letter}.jpg`) ? `${letter}.jpg` : pool[k++ % pool.length];
  p.assets.push({ id: sc.id, name: file, kind: 'image', url: 'data:image/jpeg;base64,' + fs.readFileSync(`${AZ}/public/img/${file}`).toString('base64') });
}
fs.writeFileSync('/home/claude/beatframe/scripts/az.beatframe.json', JSON.stringify(p));
console.log('wrote project', (fs.statSync('/home/claude/beatframe/scripts/az.beatframe.json').size / 1e6).toFixed(1), 'MB');
