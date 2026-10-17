import { describe, it, expect } from 'vitest';
import { parseLyrics, alignLyrics, norm } from '../src/engine/align';
import { planSections, planLetters, planSigns } from '../src/engine/planner';
import { analyze } from '../src/engine/analysis';

describe('lyrics', () => {
  it('repeats a bare section tag', () => {
    const p = parseLyrics('[Hook]\nA to Z\nEvery letter\n\n[Verse 1]\nA for Ambition\n\n[Hook]');
    expect(p.map(l => l.sec)).toEqual(['Hook1', 'Hook1', 'Verse 1', 'Hook2', 'Hook2']);
  });
  it('normalises slang endings', () => { expect(norm("stackin'")).toBe('stacking'); expect(norm("'em")).toBe('them'); });
  it('aligns words and drops unsung lines', () => {
    const parsed = parseLyrics('[Verse]\nA for Ambition always attacking\nB for Boss moves breaking records\nThis line is never sung at all');
    const asr = 'A for ambition always attacking B for boss moves breaking records'.split(' ').map((w, i) => ({ w, s: i * 0.5, e: i * 0.5 + 0.4 }));
    const lines = alignLyrics(parsed, asr, 30, { dropUnsung: true });
    expect(lines.length).toBe(2);
    expect(lines[1].start).toBeCloseTo(2.5, 2);
    expect(lines[0].letter).toBe('A');
  });
});

describe('planner', () => {
  it('finds letters, sections and street signs', () => {
    const parsed = parseLyrics('[Intro]\nYeah\n[Hook]\nRiding down Fond du Lac Ave with the bass up\n[Verse 1]\nA for Ambition, always\nB for Boss moves, breaking');
    const asr = parsed.flatMap(p => p.text.split(' ')).map((w, i) => ({ w, s: 2 + i * 0.4, e: 2 + i * 0.4 + 0.3 }));
    const lines = alignLyrics(parsed, asr, 60);
    const { sections, drops } = planSections(lines, 60);
    expect(sections.map(s => s[0])).toContain('hook');
    expect(drops.length).toBeGreaterThan(0);
    expect(planLetters(lines).map(l => l.ch)).toEqual(['A', 'B']);
    expect(planSigns(lines).map(s => s.text)).toEqual(['FOND DU LAC AVE']);
  });
});

describe('analysis', () => {
  it('finds 120 BPM in a click track', () => {
    const sr = 22050, x = new Float32Array(sr * 20);
    for (let b = 0; b < 40; b++) { const o = Math.round(b * 0.5 * sr); for (let i = 0; i < 400; i++) x[o + i] = Math.sin(i * 0.3) * Math.exp(-i / 80); }
    const a = analyze(x, sr);
    expect(Math.abs(a.tempo - 120)).toBeLessThan(2);
    expect(a.beats.length).toBeGreaterThan(30);
  });
});
