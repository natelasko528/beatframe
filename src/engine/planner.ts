// Deterministic edit planner: sections, drops, letter cues, keyword signs, scenes and beat-snapped shots.
import type { Project, Line, Shot, Scene, LetterCue, Sign, Section } from './types';
import { buildPrompt } from './prompts';

const ALPHA_WORDS: Record<string, string> = {};
const snap = (t: number, grid: number[], tol = 0.12) => {
  let best = t, bd = tol;
  for (const g of grid) { const d = Math.abs(g - t); if (d < bd) { bd = d; best = g; } if (g > t + tol) break; }
  return best;
};

export function planSections(lines: Line[], dur: number): { sections: Section[]; drops: number[] } {
  const sections: Section[] = [];
  if (!lines.length) return { sections: [['open', 0]], drops: [] };
  if (lines[0].start > 1.2) sections.push(['open', 0]);
  let prev = '';
  for (const l of lines) {
    if (l.sec !== prev) {
      const name = l.style === 'hook' ? 'hook' : l.style === 'bridge' ? 'bridge' : l.style === 'talk' ? (sections.length <= 1 ? 'intro' : 'outro') : 'verse';
      sections.push([name, +(l.start - 0.06).toFixed(3)]); prev = l.sec;
    }
  }
  const last = lines[lines.length - 1];
  const endAt = Math.min(dur - 3, Math.max(last.end + 0.8, dur - 8));
  if (dur - endAt >= 3) sections.push(['end', +endAt.toFixed(3)]);
  if (sections[0][1] > 0) sections[0][1] = 0;
  const drops = sections.filter(s => s[0] === 'hook' || s[0] === 'bridge').map(s => s[1]).slice(0, 4);
  return { sections, drops };
}

export function planLetters(lines: Line[]): LetterCue[] {
  const out: LetterCue[] = [];
  for (const l of lines) {
    if (l.letter) {
      const m = l.text.match(/^[A-Z] (?:is )?for ([A-Za-z' ]+?)(?:,|$)/);
      const word = (m ? m[1] : l.text.replace(/^[A-Z] /, '').split(/[ ,]/).slice(0, 3).join(' ')).toUpperCase().trim();
      out.push({ t: l.words[0].s, ch: l.letter, word, end: l.next, kind: 'verse' }); ALPHA_WORDS[l.letter] = word;
    }
  }
  for (const l of lines) {
    if (l.style !== 'bridge' || !/^[A-Z](-[A-Z])+/.test(l.text)) continue;
    const ws = l.words, st = (l.end - l.start) / ws.length;     // rapid-fire letters: spread evenly
    ws.forEach((w, k) => { w.s = +(l.start + k * st).toFixed(3); w.e = +(l.start + (k + 1) * st).toFixed(3); });
    ws.forEach(w => { if (/^[A-Z]$/.test(w.d)) out.push({ t: w.s, ch: w.d, word: ALPHA_WORDS[w.d] ?? w.d, end: w.e + 0.12, kind: 'bridge' }); });
  }
  out.sort((a, b) => a.t - b.t);
  out.forEach((c, i) => { if (c.kind === 'bridge') c.end = Math.min(out[i + 1]?.t ?? c.end + 0.3, c.t + 0.9); });
  return out;
}

const PLACE = /\b((?:North|South|East|West)\s?[Ss]ide|[A-Z][a-z]+(?:\s(?:du|de|la|[A-Z][a-z]+))*\s(?:Street|St|Ave|Avenue|Drive|Dr|Blvd|Road|Rd|Lane|Parkway|Pkwy|View|Point|Ward|Bridge))\b/g;
export function planSigns(lines: Line[], extra: string[] = []): Sign[] {
  const out: Sign[] = [];
  const extraRe = extra.length ? new RegExp(`\\b(${extra.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi') : null;
  for (const l of lines) {
    const found = new Set<string>();
    for (const re of [PLACE, extraRe]) { if (!re) continue; re.lastIndex = 0; let m; while ((m = re.exec(l.text))) found.add(m[1]); }
    const STOP = /^(From|To|On|In|Down|Up|The|And|Riding|Ridin'?|Slide|Posted|Off|At|By|Through)\s+/;
    for (const f0 of found) {
      let f = f0; while (STOP.test(f)) f = f.replace(STOP, '');
      const first = f.split(/\s/)[0].toLowerCase().replace(/[^a-z]/g, '');
      const w = l.words.find(w => w.d.toLowerCase().replace(/[^a-z]/g, '') === first);
      const txt = f.toUpperCase().replace(/\bAVENUE\b/, 'AVE').replace(/\bSTREET\b/, 'ST').replace(/\bDRIVE\b/, 'DR').replace(/(NORTH|SOUTH|EAST|WEST)\s?SIDE/, '$1 SIDE');
      out.push({ t: w ? w.s : l.start, text: txt, red: /SIDE/.test(txt) });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Build scene slots + shots. Re-uses scenes for repeated hooks; alphabet mode gives each letter its own scene. */
export function planEdit(p: Project, mood: string, city = ''): { shots: Shot[]; scenes: Scene[] } {
  const A = p.analysis!; const grid = A.beats; const lines = p.lines;
  const scenes: Scene[] = []; const byKey: Record<string, string> = {};
  const scene = (key: string, lyric: string, letterWord?: string, withAvatar = true): string => {
    if (byKey[key]) return byKey[key];
    const id = `S${String(scenes.length + 1).padStart(2, '0')}`;
    scenes.push({ id, withAvatar, refIds: [...p.avatar.refIds], status: 'idle',
      prompt: buildPrompt({ lyric, mood, withAvatar, avatar: p.avatar.description, letterWord, city }) });
    byKey[key] = id; return id;
  };
  const cuts: { t: number; img: string; o: Partial<Shot> }[] = [];
  const cut = (t: number, img: string, o: Partial<Shot> = {}) => cuts.push({ t: Math.max(0, snap(t, grid)), img, o });
  const sec = p.sections; const endSec = sec.find(s => s[0] === 'end');
  const firstLine = lines[0]?.start ?? 0;
  const openScene = scene('open', lines[0]?.text ?? p.meta.title);
  cut(0, openScene, { kind: 'open', z0: 1.18, z1: 1.06 });
  const hookIndex: Record<string, number> = {};
  let hookOcc = 0, prevSec = '';
  for (const l of lines) {
    if (endSec && l.start >= endSec[1]) break;
    if (l.sec !== prevSec) { if (l.style === 'hook') hookOcc++; prevSec = l.sec; }
    const isDrop = p.drops.some(d => Math.abs(d - (l.start - 0.06)) < 0.3) && cuts[cuts.length - 1]?.o.drop !== true;
    if (p.plan.mode === 'alphabet' && l.letter) {
      cut(l.words[0].s - 0.05, scene('letter-' + l.letter, l.text, p.letters.find(c => c.ch === l.letter && c.kind === 'verse')?.word), { letter: l.letter });
      continue;
    }
    if (p.plan.mode === 'alphabet' && l.style === 'bridge' && /^[A-Z](-[A-Z])+/.test(l.text)) {
      l.words.forEach((w, k) => { if (/^[A-Z]$/.test(w.d)) cut(w.s - 0.04, byKey['letter-' + w.d] ?? scene('letter-' + w.d, l.text, w.d), { flash: true, drop: isDrop && k === 0 }); });
      continue;
    }
    // hooks: the n-th line of every hook occurrence re-uses the same scene
    let key = `line-${l.i}`;
    if (l.style === 'hook') { const n = (hookIndex[l.sec] = (hookIndex[l.sec] ?? -1) + 1); key = `hook-${n % 8}`; }
    if (l.start < firstLine + 0.01 && cuts.length === 1 && l.start < 6) { /* first line rides the open card */ }
    else cut(l.start - 0.06, scene(key, l.text), { drop: isDrop });
    // long lines get a second angle on a beat
    if (l.next - l.start > 4.2 && p.plan.mode !== 'beats') {
      const mid = snap(l.start + (l.next - l.start) / 2, grid, 0.3);
      cut(mid, scene(key + '-b', l.text), {});
    }
  }
  if (p.plan.mode === 'beats') { // densify: add cuts every N beats inside long gaps
    const n = Math.max(2, p.plan.beatsPerShot);
    for (let i = 0; i < grid.length; i += n) if (!cuts.some(c => Math.abs(c.t - grid[i]) < 0.6)) {
      const l = lines.find(l => l.start <= grid[i] && l.next > grid[i]); if (l) cut(grid[i], scene(`beat-${l.i}`, l.text), {});
    }
  }
  if (endSec) cut(endSec[1], '', { kind: 'end' });
  cuts.sort((a, b) => a.t - b.t);
  const moves: [number, number, number, number, number, number][] = [[1.06, 1.16, 0, 0, 0, 0], [1.18, 1.06, 0, 0, 0, 0], [1.12, 1.14, 2.5, -2.5, 0, 0], [1.12, 1.14, -2.5, 2.5, 0, 0], [1.12, 1.2, 0, 0, 2.5, -1.5], [1.04, 1.13, 0, 0, 0, 0]];
  const shots: Shot[] = [];
  cuts.forEach((c, i) => {
    const to = cuts[i + 1]?.t ?? A.dur + 0.5;
    if (to - c.t < 0.12 && !c.o.flash) return;
    const [z0, z1, x0, x1, y0, y1] = moves[i % moves.length];
    const prevSecStart = sec.some(s => Math.abs(s[1] - c.t) < 0.3 && s[0] !== 'hook');
    shots.push({ from: +c.t.toFixed(3), to: +to.toFixed(3), img: c.img, z0, z1, x0, x1, y0, y1, ...(prevSecStart && p.style.motion.whipPans ? { whip: true } : {}), ...c.o });
  });
  // merge zero-length artefacts
  for (let i = 0; i < shots.length - 1; i++) shots[i].to = shots[i + 1].from;
  return { shots, scenes };
}
