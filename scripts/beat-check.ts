import fs from 'node:fs'; import { execFileSync } from 'node:child_process'; import { analyze } from '../src/engine/analysis';
const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', '/home/claude/az/assets/track.wav', '-ac', '1', '-ar', '22050', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const A = analyze(new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4), 22050);
const ref = JSON.parse(fs.readFileSync('/home/claude/az/assets/analysis.json', 'utf8')).beats as number[];
const d = A.beats.map(b => { let best = 9; for (const r of ref) if (Math.abs(b - r) < Math.abs(best)) best = b - r; return best; }).sort((a, b) => a - b);
console.log('offset quantiles', [0.1, 0.25, 0.5, 0.75, 0.9].map(q => d[Math.floor(q * d.length)].toFixed(3)).join(' '), 'period', (60 / A.tempo).toFixed(3));
const lines = JSON.parse(fs.readFileSync('/home/claude/az/assets/lines.json', 'utf8'));
const near = (arr: number[]) => lines.map((l: any) => Math.min(...arr.map(b => Math.abs(b - l.start)))).sort((a: number, b: number) => a - b);
const a = near(A.beats), b = near(ref); console.log('median dist line-start->beat  js', a[a.length >> 1].toFixed(3), ' librosa', b[b.length >> 1].toFixed(3));
