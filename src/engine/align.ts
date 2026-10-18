// Lyrics parsing + word-level alignment of official lyrics to any word-timestamped transcript.
// Deterministic: a global sequence alignment (Needleman–Wunsch style DP) with fuzzy token equality.
import type { Line, Word } from './types';

export interface AsrWord { w: string; s: number; e: number }
export interface ParsedLine { sec: string; text: string }

const CONTRACTIONS: Record<string, string> = { em: 'them', ya: 'you', cuz: 'because', bout: 'about', tryna: 'tryingto', gonna: 'goingto' };
export function norm(w: string): string {
  let t = w.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9']/g, '').replace(/'/g, '');
  if (CONTRACTIONS[t]) t = CONTRACTIONS[t];
  if (/in$/.test(t) && t.length > 3) t = t + 'g';           // stackin -> stacking
  const nums: Record<string, string> = { '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '26': 'twentysix', '100': 'hundred' };
  return nums[t] ?? t;
}
function similar(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length > 3 && b.length > 3 && (a.startsWith(b) || b.startsWith(a))) return true;
  // one edit away for longer words
  if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++edits > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Parse lyrics with [Section] tags. A bare tag that repeats an earlier section name re-inserts that section's lines. */
export function parseLyrics(raw: string): ParsedLine[] {
  const out: ParsedLine[] = []; const bank: Record<string, string[]> = {}; const counts: Record<string, number> = {};
  let sec = 'Verse', cur: string[] = [];
  const flush = () => {
    const base = sec.replace(/\s*\d+$/, '').trim();
    if (cur.length === 0 && bank[base]) cur = [...bank[base]];
    else if (cur.length) bank[base] = [...cur];
    counts[base] = (counts[base] || 0) + 1;
    const name = /hook|chorus/i.test(base) ? `${base}${counts[base]}` : sec;
    cur.forEach(text => out.push({ sec: name, text }));
    cur = [];
  };
  let started = false;
  for (const rawLine of raw.split(/\r?\n/)) {
    const l = rawLine.trim();
    const m = l.match(/^\[(.+?)\]$/);
    if (m) { if (started) flush(); sec = m[1].replace(/\s*[—–-].*$/, '').trim(); started = true; continue; }
    if (!l || /^\(.*\)$/.test(l)) continue;                     // skip blank and pure performance notes "(rapid-fire)"
    started = true; cur.push(l.replace(/\s*\((?:x\d+|\d+x)\)\s*$/i, ''));
  }
  if (started) flush();
  return out;
}

export function lineStyle(sec: string): Line['style'] {
  if (/intro|outro|skit|talk/i.test(sec)) return 'talk';
  if (/hook|chorus|refrain/i.test(sec)) return 'hook';
  if (/bridge|chant|break/i.test(sec)) return 'bridge';
  return 'verse';
}
const tokenize = (text: string) => text.split(/[\s]+|(?<=[A-Z])-(?=[A-Z])/).filter(t => norm(t));

/** Align parsed lines to ASR words. Unsung lines (e.g. a hook the artist cut short) are dropped when `dropUnsung`. */
export function alignLyrics(parsed: ParsedLine[], asr: AsrWord[], dur: number, opts: { dropUnsung?: boolean } = {}): Line[] {
  const toks: { li: number; wi: number; n: string; d: string }[] = [];
  const lines: Line[] = parsed.map((p, li) => {
    const words: Word[] = tokenize(p.text).map((d, wi) => { toks.push({ li, wi, n: norm(d), d }); return { d, s: 0, e: 0 }; });
    return { i: li, sec: p.sec, text: p.text, words, start: 0, end: 0, next: 0, style: lineStyle(p.sec) };
  });
  const A = asr.filter(w => norm(w.w)).map(w => ({ ...w, n: norm(w.w) }));
  const n = toks.length, m = A.length;
  const match = new Int32Array(n).fill(-1);
  if (m > 0 && n > 0) {
    // banded global alignment: score +2 match, -1 gap. Band keeps it O((n+m)*band).
    const band = Math.max(200, Math.abs(n - m) + 120);
    const W = m + 1, S = new Float32Array((n + 1) * W).fill(-1e9), B = new Uint8Array((n + 1) * W);
    S[0] = 0; for (let j = 1; j <= Math.min(m, band); j++) { S[j] = -0.2 * j; B[j] = 2; }
    for (let i = 1; i <= n; i++) {
      const center = Math.round(i * m / n), j0 = Math.max(0, center - band), j1 = Math.min(m, center + band);
      for (let j = j0; j <= j1; j++) {
        const id = i * W + j; let best = -1e9, bk = 0;
        if (j > 0) { const v = S[(i - 1) * W + j - 1] + (similar(toks[i - 1].n, A[j - 1].n) ? 2 : -1.2); if (v > best) { best = v; bk = 0; } }
        { const v = S[(i - 1) * W + j] - 1; if (v > best) { best = v; bk = 1; } }                 // lyric word not sung / not heard
        if (j > 0) { const v = S[i * W + j - 1] - 0.2; if (v > best) { best = v; bk = 2; } }      // ASR extra word (ad-lib)
        S[id] = best; B[id] = bk;
      }
    }
    let i = n, j = m;
    while (i > 0) {
      const bk = B[i * W + j];
      if (bk === 0 && j > 0) { if (similar(toks[i - 1].n, A[j - 1].n)) match[i - 1] = j - 1; i--; j--; }
      else if (bk === 1 || j === 0) i--;
      else j--;
    }
  }
  // assign times, interpolating unmatched words between matched neighbours
  const time: [number, number][] = new Array(n);
  for (let k = 0; k < n; k++) if (match[k] >= 0) time[k] = [A[match[k]].s, A[match[k]].e];
  const known = [...Array(n).keys()].filter(k => time[k]);
  for (let k = 0; k < n; k++) {
    if (time[k]) continue;
    const p = known.filter(x => x < k).pop(), q = known.find(x => x > k);
    if (p === undefined && q === undefined) { const s = (k / n) * dur; time[k] = [s, s + 0.25]; continue; }
    if (p === undefined) { const s = time[q!][0] - 0.3 * (q! - k); time[k] = [Math.max(0, s), Math.max(0.05, s + 0.25)]; continue; }
    if (q === undefined) { const s = time[p][1] + 0.3 * (k - p); time[k] = [s, s + 0.25]; continue; }
    const a = time[p][1], b = time[q][0], st = (b - a) / (q - p);
    time[k] = [a + st * (k - p - 1) + 0.01, a + st * (k - p)];
  }
  toks.forEach((t, k) => { const w = lines[t.li].words[t.wi]; w.s = +time[k][0].toFixed(3); w.e = +time[k][1].toFixed(3); w.m = match[k] >= 0; });
  let out = lines.filter(l => l.words.length);
  if (opts.dropUnsung && m > 0) out = out.filter(l => l.words.filter(w => w.m).length / l.words.length >= 0.25 || l.words.length <= 2);
  return finalizeLines(out);
}

/** Recompute start/end/next/index + derived flags. Call after any manual edit. */
export function finalizeLines(lines: Line[]): Line[] {
  lines.sort((a, b) => a.words[0].s - b.words[0].s);
  lines.forEach((l, i) => {
    l.i = i; l.start = l.words[0].s; l.end = l.words[l.words.length - 1].e;
    const m = l.text.match(/^([A-Z]) (for|mark|is for)\b/);
    l.letter = m && l.style === 'verse' ? m[1] : null;
    l.stamp = l.style !== 'talk' && l.words.length <= 3 && /!$/.test(l.text);
  });
  lines.forEach((l, i) => { l.next = i + 1 < lines.length ? lines[i + 1].start : l.end + 3; });
  return lines;
}

/** No-AI fallback 1: spread lines across a time range by syllable weight. */
export function spreadLines(parsed: ParsedLine[], start: number, end: number): Line[] {
  const syl = (w: string) => Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) || []).length);
  const weights = parsed.map(p => tokenize(p.text).reduce((a, w) => a + syl(w), 0) + 1.5);
  const total = weights.reduce((a, b) => a + b, 0); let t = start;
  return finalizeLines(parsed.map((p, li) => {
    const span = (end - start) * weights[li] / total, toks = tokenize(p.text), ws = toks.map(syl), wt = ws.reduce((a, b) => a + b, 0);
    let tt = t; const words = toks.map((d, k) => { const dd = span * 0.85 * ws[k] / wt; const w = { d, s: +tt.toFixed(3), e: +(tt + dd).toFixed(3) }; tt += dd; return w; });
    t += span; return { i: li, sec: p.sec, text: p.text, words, start: 0, end: 0, next: 0, style: lineStyle(p.sec) };
  }));
}

/** No-AI fallback 2: tap-sync. `taps` are line start times recorded while the user listens. */
export function linesFromTaps(parsed: ParsedLine[], taps: number[], dur: number): Line[] {
  return finalizeLines(parsed.map((p, li) => {
    const s = taps[li] ?? (taps[taps.length - 1] ?? 0) + 2 * (li - taps.length + 1);
    const e = (taps[li + 1] ?? Math.min(dur, s + 3)) - 0.08;
    const toks = tokenize(p.text), st = Math.max(0.12, (e - s) / Math.max(1, toks.length));
    return { i: li, sec: p.sec, text: p.text, start: 0, end: 0, next: 0, style: lineStyle(p.sec),
      words: toks.map((d, k) => ({ d, s: +(s + k * st).toFixed(3), e: +(s + (k + 1) * st - 0.02).toFixed(3) })) };
  }));
}

/** No-AI fallback 3: LRC import ([mm:ss.xx] text). Section tags in the official lyrics are matched by order. */
export function linesFromLRC(lrc: string, parsed: ParsedLine[], dur: number): Line[] {
  const taps: number[] = [];
  for (const row of lrc.split(/\r?\n/)) { const m = row.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.+)$/); if (m) taps.push(+m[1] * 60 + +m[2]); }
  return linesFromTaps(parsed, taps, dur);
}

/** No lyrics pasted: build lines straight from the transcript. Pauses split lines; lines that repeat become the hook. */
export function linesFromTranscript(asr: AsrWord[], dur: number): Line[] {
  const ws = asr.filter(w => w.w.trim());
  const groups: AsrWord[][] = []; let cur: AsrWord[] = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i], prev = ws[i - 1];
    const gap = prev ? w.s - prev.e : 0;
    if (cur.length && (gap > 0.42 || cur.length >= 10 || (/[.!?]$/.test(prev.w.trim()) && cur.length >= 4))) { groups.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);
  const text = (g: AsrWord[]) => g.map(w => w.w.trim()).join(' ').replace(/\s+([,.!?])/g, '$1');
  const key = (g: AsrWord[]) => g.map(w => norm(w.w)).join(' ');
  const counts = new Map<string, number>(); groups.forEach(g => counts.set(key(g), (counts.get(key(g)) || 0) + 1));
  let sec = 'Verse 1', verseN = 1, hookN = 0, lastEnd = 0, prevHook = false;
  const lines: Line[] = groups.map((g, i) => {
    const isHook = (counts.get(key(g)) || 0) >= 2 && g.length >= 3;
    const bigGap = g[0].s - lastEnd > 2.5 && i > 0;
    if (isHook && !prevHook) { hookN++; sec = `Hook${hookN}`; }
    else if (!isHook && (prevHook || bigGap)) { verseN += prevHook ? 1 : 0; sec = `Verse ${verseN}`; }
    prevHook = isHook; lastEnd = g[g.length - 1].e;
    const t = text(g).replace(/^./, c => c.toUpperCase());
    return { i, sec, text: t, start: 0, end: 0, next: 0, style: isHook ? 'hook' : 'verse', words: g.map(w => ({ d: w.w.trim(), s: +w.s.toFixed(3), e: +w.e.toFixed(3), m: true })) } as Line;
  });
  return finalizeLines(lines);
}
