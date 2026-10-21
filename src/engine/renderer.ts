// BeatFrame unified renderer. Deterministic: renderAt(t) always draws the same frame for the same project,
// so preview, browser export and headless CLI render are identical. Canvas 2D, plus an optional WebGL2
// layer (motion.ts) that brings stills to life when depth maps exist; without WebGL it falls back to plain stills.
import type { Project, Shot, Line, LetterCue } from './types';
import { FONT_WEIGHT } from './styles';
import { DepthMotion, depthId } from './motion';
import { ClipBank, clipId, clipTime } from './clips';

type Img = CanvasImageSource & { width: number; height: number };
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
// Where to crop an image that's taller than the frame: 0.5 = centre, lower keeps more of the top (faces live in the upper third).
const V_ANCHOR = 0.3;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
const easeIn = (k: number) => k * k * k;
const easeIO = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeBack = (k: number) => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
const hash = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
function lastBefore(a: number[], t: number) { let lo = 0, hi = a.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m] <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; }
const rgba = (hex: string, a: number) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
function mk(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

export class Renderer {
  p: Project; cv: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx; imgs: Record<string, Img>;
  W: number; H: number; u: number; vertical: boolean;
  private bloom: any; private bloom2: any; private mask: any; private mctx: Ctx; private grain: any[] = []; private glow: any;
  private kicksArr: number[]; private hits: { t: number; a: number; d: number }[] = []; private hitT: number[] = []; private letterTimes: number[]; private motion: DepthMotion | null | undefined;
  clips: ClipBank | null = null;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, project: Project, images: Record<string, Img>) {
    this.cv = canvas; this.p = project; this.imgs = images;
    this.W = canvas.width; this.H = canvas.height; this.u = Math.min(this.W, this.H) / 1080; this.vertical = this.H > this.W;
    this.ctx = canvas.getContext('2d') as Ctx;
    this.bloom = mk(480, Math.round(480 * this.H / this.W)); this.bloom2 = mk(480, Math.round(480 * this.H / this.W));
    this.mask = mk(this.W, this.H); this.mctx = this.mask.getContext('2d');
    for (let k = 0; k < 4; k++) {
      const c = mk(512, 512); const g = c.getContext('2d') as Ctx; const id = g.createImageData(512, 512);
      for (let i = 0; i < id.data.length; i += 4) { const v = hash(i * 0.37 + k * 999) * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
      g.putImageData(id, 0, 0); this.grain.push(c);
    }
    this.glow = mk(64, 64); { const g = this.glow.getContext('2d') as Ctx; const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }
    this.kicksArr = project.analysis?.kicks ?? []; this.buildHits();
    this.letterTimes = project.letters.map(l => l.t - 0.05);
  }
  setClips(bank: ClipBank | null) { this.clips = bank; }
  /** Decode the video-clip frames needed at time t (current shot and the one it may be transitioning from). Await before renderAt(t) for frame-exact output. */
  async prepare(t: number) {
    const bank = this.clips; if (!bank) return;
    const s = this.shotAt(t); if (!s) return; const i = this.p.shots.indexOf(s);
    const need = [s, t - s.from < 0.5 ? this.p.shots[i - 1] : undefined].filter(Boolean) as Shot[];
    await Promise.all(need.map(async x => { const id = clipId(x.img); if (!bank.has(id)) return; const d = await bank.durationOf(id); await bank.seek(id, clipTime(t - x.from, x.to - x.from, d)); }));
  }
  setProject(p: Project) { this.p = p; this.kicksArr = p.analysis?.kicks ?? []; this.buildHits(); this.letterTimes = p.letters.map(l => l.t - 0.05); }

  // ---------- timing helpers ----------
  private pulse(a: number[], t: number, d: number) { const i = lastBefore(a, t); return i < 0 ? 0 : Math.exp(-(t - a[i]) / d); }
  /** Clean drum hits: at most one per beat, only where a kick or snare actually lands on it (no hi-hat chatter).
   *  Snares hit harder than kicks, quiet passages and verses softer, drops hardest. */
  private buildHits() {
    const A = this.p.analysis; this.hits = []; if (!A) return;
    const near = (arr: number[], b: number) => { const i = lastBefore(arr, b + 0.06); return i >= 0 && b - arr[i] <= 0.06 ? true : false; };
    const rms = A.rms ?? [], sorted = [...rms].sort((x, y) => x - y), p90 = sorted[Math.floor(sorted.length * 0.9)] || 1;
    A.beats.forEach((b, i) => {
      const k = near(this.kicksArr, b), s = near(A.snares ?? [], b); if (!k && !s) return;
      const loud = clamp((rms[Math.floor(b / (A.curveDt || 0.1))] ?? p90) / p90, 0.3, 1);
      const drop = this.p.drops.some(d => Math.abs(d - b) < 0.12);
      const a = (s ? 1 : 0.7) * loud * (drop ? 1.7 : this.big(b) ? 1 : 0.7);
      this.hits.push({ t: b, a, d: hash(i * 3.1) > 0.5 ? 1 : -1 });
    });
    this.hitT = this.hits.map(h => h.t);
  }
  /** Drum envelope 0..1 (decays after each clean hit). Drives every beat-synced pulse. */
  kick(t: number) { const i = lastBefore(this.hitT, t); return i < 0 ? 0 : this.hits[i].a * Math.exp(-(t - this.hits[i].t) / 0.12); }
  /** Whole-frame camera jolt on each hit: instant knock, then a damped spring settle (~0.35 s). */
  jolt(t: number) {
    const i = lastBefore(this.hitT, t); if (i < 0) return { x: 0, y: 0, z: 1 };
    const h = this.hits[i], dt = t - h.t, e = Math.exp(-dt / 0.11), spring = e * Math.cos(2 * Math.PI * 3 * dt), A = h.a * (this.p.style.motion.shake / 3) * this.u;
    return { x: 6 * A * h.d * spring, y: 18 * A * spring, z: 1 + 0.022 * h.a * (this.p.style.motion.shake / 3) * e };
  }
  section(t: number) { let s = this.p.sections[0] ?? ['open', 0]; for (const x of this.p.sections) if (t >= x[1]) s = x; return s; }
  big(t: number) { return /hook|bridge|chant/.test(this.section(t)[0]); }
  shotAt(t: number): Shot { const s = this.p.shots; let lo = 0, hi = s.length - 1, r = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m].from <= t) { r = m; lo = m + 1; } else hi = m - 1; } return s[r]; }
  endStart() { const e = this.p.sections.find(s => s[0] === 'end'); return e ? e[1] : (this.p.analysis?.dur ?? 1e9); }
  font(fam: string, sz: number, opts = '') { const weight = FONT_WEIGHT[fam] ?? '400'; return `${opts.includes('italic') && fam === 'Playfair Display' ? 'italic ' : ''}${weight} ${Math.round(sz)}px "${fam}"`; }
  foil(c: Ctx, x0: number, y0: number, x1: number, y1: number, t: number) {
    const st = this.p.style; const g = c.createLinearGradient(x0, y0, x1, y1), sh = (t * 0.45) % 1.6 - 0.3;
    const base = st.palette.accent;
    g.addColorStop(0, shade(base, -0.45)); g.addColorStop(0.25, shade(base, 0.12)); g.addColorStop(clamp(sh - 0.08), shade(base, -0.1));
    g.addColorStop(clamp(sh), '#fff6dc'); g.addColorStop(clamp(sh + 0.08), shade(base, 0.05)); g.addColorStop(0.8, shade(base, -0.25)); g.addColorStop(1, shade(base, -0.55));
    return g;
  }

  // ---------- shots ----------
  private cover(c: Ctx, img: Img | undefined, z: number, xp: number, yp: number, alpha = 1) {
    if (!img) { c.fillStyle = this.p.style.palette.bg; c.fillRect(0, 0, this.W, this.H); return; }
    const s = Math.max(this.W / img.width, this.H / img.height) * z, w = img.width * s, h = img.height * s;
    c.globalAlpha = alpha; c.drawImage(img, (this.W - w) / 2 + (xp / 100) * this.W, (this.H - h) * V_ANCHOR + (yp / 100) * this.H, w, h); c.globalAlpha = 1;
  }
  private paintShot(c: Ctx, s: Shot, t: number) {
    const st = this.p.style, len = s.to - s.from, a = t - s.from, k = easeIO(clamp(a / Math.max(len, 0.1)));
    const z = lerp(s.z0, s.z1, k), x = lerp(s.x0, s.x1, k), y = lerp(s.y0, s.y1, k);
    const kick = this.kick(t);
    const layered = !!this.imgs[`${s.img}~L0`];
    const bump = layered ? 1 : 1 + st.motion.kickZoom * kick * (this.big(t) ? 1.6 : 0.6);   // layered scenes: the beat moves the whole frame instead
    const punch = 1 + (s.drop ? 0.14 : s.flash ? 0.07 : layered ? 0 : st.motion.cutPunch) * Math.pow(clamp(1 - a / (s.drop ? 0.38 : 0.22)), 2);
    const clip = this.clips?.frame(clipId(s.img));
    const img = (clip as Img | undefined) ?? this.imgs[s.img];
    if (s.flash) (c as any).filter = `contrast(1.25) saturate(1.2) brightness(${1 + 0.5 * clamp(1 - a / 0.12)})`;
    const whip = s.whip && !s.drop ? clamp(1 - a / 0.24) : 0;
    if (whip > 0) { const wx = easeOut(whip) * 22; for (let i = 0; i < 5; i++) this.cover(c, img, z * bump * punch, x + wx + i * 3 * whip, y, 0.28); }
    else if (clip) this.cover(c, img, (1 + (z - 1) * 0.35) * bump * punch, x * 0.35, y * 0.35);   // real motion: keep only a light push on top
    else if (!this.layered(c, s, z * punch, x, y, clamp(a / Math.max(len, 0.1))) && !this.living(c, s, img, z * bump * punch, x, y, t, k, kick)) this.cover(c, img, z * bump * punch, x, y);
    (c as any).filter = 'none';
  }
  /** Layered 2.5D parallax: far / mid / subject planes, each rigid, gliding at its own speed and zoom from the first frame of the shot to the last.
   *  Subject and mid layer nearly share the lateral move (so contact points barely skate) and pull apart in zoom around the subject's head. */
  private layered(c: Ctx, s: Shot, z: number, xp: number, yp: number, k: number) {
    const L = [0, 1, 2].map(i => this.imgs[`${s.img}~L${i}`]); if (!L[0] || !L[1] || !L[2]) return false;
    const strength = this.p.style.motion.depth ?? 0.8, an = this.p.scenes.find(x => x.id === s.img)?.anchor ?? [0.5, 0.4];
    const iw = L[0].width, ih = L[0].height, s1 = Math.max(this.W / iw, this.H / ih) * 1.08, w1 = iw * s1, h1 = ih * s1, w = w1 * z, h = h1 * z;
    // camera push pivots on the subject's head: it holds its place on screen while everything else grows around it (clamped so the frame stays covered)
    const fx = (this.W - w1) / 2 + an[0] * w1, fy = (this.H - h1) * V_ANCHOR + an[1] * h1, mx = 0.03 * this.W, my = 0.02 * this.H;
    const x0 = clamp(fx - an[0] * w, this.W - w + mx, -mx) + (xp / 100) * this.W, y0 = clamp(fy - an[1] * h, this.H - h + my, -my) + (yp / 100) * this.H;
    const seed = Math.round(s.from * 1000) + s.img.length * 7, ang = (hash(seed) - 0.5) * 0.7 + (hash(seed + 1) > 0.5 ? 0 : Math.PI);
    const kk = 0.5 * k + 0.5 * (0.5 - 0.5 * Math.cos(Math.PI * k)), m = kk - 0.5;        // near-constant glide, softened at the ends
    const T = 0.045 * this.W * strength, dx = Math.cos(ang) * T * m, dy = Math.sin(ang) * T * m * 0.5;
    const ax = x0 + an[0] * w, ay = y0 + an[1] * h;
    const plan: [number, number][] = [[0.35, 0], [1, 0.025 * strength], [1.12, 0.065 * strength]];   // [lateral speed, zoom gained over the shot]
    plan.forEach(([par, zg], i) => {
      c.save(); c.translate(dx * par, dy * par);
      const zz = 1 + zg * kk; c.translate(ax, ay); c.scale(zz, zz); c.translate(-ax, -ay);
      c.drawImage(L[i] as any, x0, y0, w, h); c.restore();
    });
    return true;
  }
  /** Living still: depth parallax + water/foliage motion. Returns false when it can't run (no depth map / no WebGL). */
  private living(c: Ctx, s: Shot, img: Img | undefined, z: number, xp: number, yp: number, t: number, k: number, kick: number) {
    const strength = this.p.style.motion.depth ?? 0.8, dep = this.imgs[depthId(s.img)];
    if (!img || !dep || strength <= 0) return false;
    if (this.motion === undefined) this.motion = DepthMotion.create(this.W, this.H);
    if (!this.motion) return false;
    const sc = Math.max(this.W / img.width, this.H / img.height) * z, w = img.width * sc, h = img.height * sc;
    const x0 = (this.W - w) / 2 + (xp / 100) * this.W, y0 = (this.H - h) * V_ANCHOR + (yp / 100) * this.H;
    const seed = Math.round(s.from * 1000) + s.img.length * 7, ang = hash(seed) * Math.PI * 2, sign = hash(seed + 3) > 0.5 ? 1 : -1;
    const travel = (k - 0.5) * 0.13 * strength;                  // camera slides ~10% of the frame across a shot, centred so cuts stay clean
    const cam: [number, number] = [Math.cos(ang) * travel, Math.sin(ang) * travel * 0.45];
    const dolly = sign * (k - 0.5) * 0.4 * strength + 0.08 * strength * kick;
    const cv = this.motion.draw(img, dep, { rect: [x0 / this.W, y0 / this.H, w / this.W, h / this.H], cam, dolly, focus: 0.35, t, water: strength, sway: strength });
    c.drawImage(cv as any, 0, 0, this.W, this.H);
    return true;
  }
  private drawShot(s: Shot, t: number) {
    const c = this.ctx, a = t - s.from, idx = this.p.shots.indexOf(s), prev = this.p.shots[idx - 1], T = 0.5;
    if (this.p.style.motion.letterMask && s.letter && prev && prev.img && a < T) {
      this.paintShot(c, prev, t);
      const k = easeIn(clamp(a / T)), m = this.mctx, sc = 0.55 + 38 * k;
      m.setTransform(1, 0, 0, 1, 0, 0); m.globalCompositeOperation = 'source-over'; m.clearRect(0, 0, this.W, this.H);
      m.save(); m.translate(this.W / 2, this.H * 0.56); m.scale(sc * this.u, sc * this.u);
      m.font = this.font(this.p.style.fonts.display, 700); m.textAlign = 'center'; m.textBaseline = 'middle'; m.fillStyle = '#fff'; m.fillText(s.letter, 0, 30); m.restore();
      m.globalCompositeOperation = 'source-in'; this.paintShot(m, s, t); m.globalCompositeOperation = 'source-over';
      c.save(); c.translate(this.W / 2, this.H * 0.56); c.scale(sc * this.u, sc * this.u); c.font = this.font(this.p.style.fonts.display, 700);
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 6 / sc; c.strokeStyle = rgba(this.p.style.palette.accent, 1 - k);
      c.shadowColor = rgba(this.p.style.palette.accent, 0.9); c.shadowBlur = 30; c.strokeText(s.letter, 0, 30); c.restore(); c.shadowBlur = 0;
      c.drawImage(this.mask, 0, 0);
    } else this.paintShot(c, s, t);
  }

  // ---------- lyrics ----------
  private lineAt(t: number) { const L = this.p.lines; let r = -1; for (let i = 0; i < L.length; i++) if (L[i].start - 0.14 <= t) r = i; else break; return r; }
  private drawLyrics(t: number) {
    const c = this.ctx, st = this.p.style, P = st.palette, u = this.u, li = this.lineAt(t); if (li < 0) return;
    const L = this.p.lines[li];
    if (L.stamp && st.features.stamps) return;
    if (st.features.bigLetters && L.style === 'bridge' && /^[A-Z](-[A-Z])+/.test(L.text)) return;
    if (st.features.dictionaryOpen && L === this.introTypeLine()) return;
    const hide = Math.min(L.next - 0.04, L.end + 1.8); if (t > hide) return;
    const out = clamp((t - (hide - 0.15)) / 0.15);
    const talk = L.style === 'talk', hook = L.style === 'hook';
    const layout = this.vertical ? 'lower-center' : st.lyrics.layout;
    const left = layout === 'lower-left';
    const verseLetter = st.lyrics.alliteration ? L.letter : null;
    const fs = st.lyrics.size * u * (talk ? 0.75 : hook ? st.lyrics.hookScale : 1) * (this.vertical ? 0.9 : 1);
    const centerX = left ? 0 : verseLetter && !this.vertical ? this.W * 0.646 : this.W / 2;
    const X0 = 118 * u, maxW = left ? this.W * (hook ? 0.56 : 0.5) : verseLetter && !this.vertical ? this.W * 0.615 : this.W * (this.vertical ? 0.86 : 0.78);
    const gap = fs * 0.25;
    const titleToks = this.p.meta.title.toLowerCase().split(/\s+/);
    const boxN = hook && L.text.toLowerCase().startsWith(this.p.meta.title.toLowerCase()) ? titleToks.length : 0;
    const hot = new Set(st.lyrics.hotWords.map(w => w.toUpperCase()));
    const signWords = new Set<number>(); this.p.signs.forEach(sg => { if (sg.t >= L.start - 0.05 && sg.t <= L.end + 0.05) L.words.forEach((w, i) => { if (Math.abs(w.s - sg.t) < 0.02) for (let j = 0; j < sg.text.split(' ').length; j++) signWords.add(i + j); }); });
    const words = L.words.map((w, i) => {
      const clean = w.d.replace(/[^A-Za-z]/g, ''); const up = clean.toUpperCase();
      const allit = !!verseLetter && clean.length > 1 && up[0] === verseLetter;
      const isHot = hot.has(up);
      const fam = talk ? st.fonts.hot : allit || isHot ? st.fonts.hot : st.fonts.lyric;
      const f = this.font(fam, allit ? fs * 0.92 : isHot ? fs * 1.02 : fs, talk || allit ? 'italic' : '');
      const txt = talk || allit || st.lyrics.case === 'as-is' ? w.d : w.d.toUpperCase();
      c.font = f; return { ...w, i, allit, isHot, f, txt, w2: c.measureText(txt).width, box: i < boxN, street: signWords.has(i) };
    });
    const rows: (typeof words)[] = [[]]; let rw = 0;
    words.forEach(w => { if (rw + w.w2 > maxW && rows[rows.length - 1].length) { rows.push([]); rw = 0; } rows[rows.length - 1].push(w); rw += w.w2 + gap; });
    const LB = st.grade.letterbox * u; const lh = fs * 1.1, bottom = this.H - LB - (this.vertical ? this.H * 0.16 : 60 * u), baseY = bottom - rows.length * lh;
    // legibility pool
    const g = c.createLinearGradient(0, baseY - 140 * u, 0, this.H); g.addColorStop(0, rgba(P.bg, 0)); g.addColorStop(1, rgba(P.bg, 0.6 * (1 - out)));
    c.fillStyle = g; c.fillRect(0, baseY - 140 * u, this.W, this.H);
    c.save(); c.textBaseline = 'alphabetic';
    rows.forEach((row, ri) => {
      const rowW = row.reduce((s, w) => s + w.w2, 0) + gap * (row.length - 1);
      let x = left ? X0 : centerX - rowW / 2; const yb = baseY + (ri + 1) * lh - fs * 0.16;
      row.forEach(w => {
        const p = clamp((t - (w.s - 0.08)) / 0.2);
        if (p > 0) {
          const e = easeOut(p), active = t >= w.s - 0.04 && t <= w.e + 0.08, rev = st.lyrics.reveal;
          c.save();
          const dy = rev === 'rise' ? (1 - e) * fs * 0.7 : rev === 'blur' ? (1 - e) * 18 * u : 0;
          const sc = rev === 'pop' ? 0.6 + 0.4 * easeBack(p) : rev === 'blur' ? 1 + 0.18 * (1 - e) : 1;
          c.translate(x + w.w2 / 2, yb + dy); c.scale(sc, sc); if (w.isHot && !w.allit) c.rotate(-0.045);
          c.font = w.f; c.textAlign = 'center'; c.globalAlpha = clamp(p * 1.6) * (1 - out);
          if (rev === 'blur' && p < 1) (c as any).filter = `blur(${(1 - e) * 8 * u}px)`;
          c.shadowColor = 'rgba(0,0,0,.68)'; c.shadowBlur = 22 * u; c.shadowOffsetY = 6 * u;
          if (w.box) { c.fillStyle = P.accent2; const pad = 10 * u; c.fillRect(-w.w2 / 2 - pad, -fs * 0.82, w.w2 + pad * 2, fs * 0.92); c.shadowBlur = 0; c.fillStyle = '#fff'; }
          else c.fillStyle = w.allit ? this.foil(c, -w.w2 / 2, -fs, w.w2 / 2, 0, t) : w.isHot ? P.hot : active && !talk ? st.lyrics.activeColor : P.text;
          if (rev === 'type') { const n = Math.ceil(w.txt.length * clamp(p * 1.4)); c.fillText(w.txt.slice(0, n), 0, 0); } else c.fillText(w.txt, 0, 0);
          (c as any).filter = 'none'; c.shadowBlur = 0; c.shadowOffsetY = 0;
          if (w.street) { const uk = easeOut(clamp((t - w.s) / 0.25)); c.fillStyle = P.accent; c.fillRect(-w.w2 / 2, fs * 0.12, w.w2 * uk, Math.max(5, fs * 0.065)); }
          c.restore();
        }
        x += w.w2 + gap;
      });
    });
    c.restore(); c.globalAlpha = 1;
  }

  // ---------- signs / captions / stamps ----------
  private drawSigns(t: number, shot: Shot) {
    const c = this.ctx, P = this.p.style.palette, u = this.u, LB = this.p.style.grade.letterbox * u;
    const right = shot.x0 > shot.x1 ? false : (hash(Math.floor(shot.from * 10)) > 0.6);
    this.p.signs.forEach((s, idx) => {
      if (t < s.t - 0.08 || t >= s.t + 2.4) return;
      const a = t - (s.t - 0.08), slot = idx % 3, inK = clamp(a / 0.28), outK = clamp((a - 2) / 0.4);
      const sc = 0.78 * u * (0.3 + 0.7 * easeBack(inK)) * (1 - 0.25 * outK);
      const rot = (((slot - 1) * 3.5 + Math.sin(a * 6) * 3 * (1 - inK)) * Math.PI) / 180;
      const fx = [0.17, 0.23, 0.14][slot] * this.W, x = right ? this.W - fx + outK * 700 * u : fx - outK * 700 * u;
      const y = LB + [70, 160, 250][slot] * u - (1 - easeOut(inK)) * 160 * u + (this.vertical ? this.H * 0.12 : 0);
      c.save(); c.translate(x, y); c.rotate(rot); c.scale(sc, sc); c.globalAlpha = 1 - outK;
      c.font = this.font(this.p.style.fonts.ui, 62); const w = c.measureText(s.text).width + 70, h = 96;
      c.fillStyle = 'rgba(0,0,0,.4)'; rr(c, -w / 2 + 10, -h / 2 + 14, w, h, 12); c.fill();
      c.fillStyle = s.red ? P.signAlt : P.sign; rr(c, -w / 2, -h / 2, w, h, 12); c.fill();
      c.strokeStyle = '#f4f1ea'; c.lineWidth = 5; rr(c, -w / 2 + 9, -h / 2 + 9, w - 18, h - 18, 7); c.stroke();
      const sh = c.createLinearGradient(0, -h / 2, 0, h / 2); sh.addColorStop(0, 'rgba(255,255,255,.22)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); c.fillStyle = sh; rr(c, -w / 2, -h / 2, w, h, 12); c.fill();
      c.fillStyle = '#f7f4ec'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(s.text, 0, 4); c.restore();
    });
  }
  private drawCaption(s: Shot, t: number) {
    if (!s.caption) return; const c = this.ctx, u = this.u, a = t - s.from, len = s.to - s.from, LB = this.p.style.grade.letterbox * u;
    const k = clamp((a - 0.25) / 0.35) * clamp((len - a - 0.1) / 0.3); if (k <= 0) return;
    c.save(); c.globalAlpha = k; c.font = this.font(this.p.style.fonts.ui, 24 * u); (c as any).letterSpacing = `${7 * u}px`; c.textAlign = 'right';
    const x = this.W - 96 * u, y = this.H - LB - 46 * u, tw = c.measureText(s.caption).width;
    c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 12; c.fillStyle = rgba(this.p.style.palette.text, 0.92); c.fillText(s.caption, x + 7 * u, y);
    c.fillStyle = this.p.style.palette.accent2; c.fillRect(x - tw - 46 * u * easeOut(k), y - 10 * u, 34 * u * easeOut(k), 3 * u);
    c.restore(); (c as any).letterSpacing = '0px';
  }
  private drawStamp(t: number) {
    const c = this.ctx, u = this.u, li = this.lineAt(t); if (li < 0) return; const L = this.p.lines[li];
    if (!L.stamp || t > Math.min(L.next, L.end + 1.6)) return;
    const a = t - L.start + 0.05, k = easeBack(clamp(a / 0.22)), P = this.p.style.palette;
    const txt = L.text.replace(/!+$/, '').toUpperCase(); const ws = txt.split(' ');
    const rows = txt.length > 12 ? [ws.slice(0, Math.ceil(ws.length / 2)).join(' '), ws.slice(Math.ceil(ws.length / 2)).join(' ')] : [txt];
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 0, this.W, this.H);
    c.save(); c.translate(this.W / 2, this.H / 2); c.rotate(-0.035); const z = (1.6 - 0.6 * k) * (1 + 0.05 * this.kick(t)) * u * (this.vertical ? 0.6 : 1); c.scale(z, z);
    const fs = rows.length > 1 ? 180 : 230; c.textAlign = 'center'; c.textBaseline = 'middle';
    rows.forEach((r, i) => { const y = (i - (rows.length - 1) / 2) * fs; const last = i === rows.length - 1 && rows.length > 1;
      c.font = last ? this.font(this.p.style.fonts.hot, fs * 0.95) : this.font(this.p.style.fonts.display, fs); c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 40; c.fillStyle = last ? P.hot : P.text; c.fillText(r, 0, y); c.shadowBlur = 0; });
    const sw = clamp((a - 0.15) / 0.35) * 900, yy = fs * 0.62 * rows.length; c.fillStyle = P.accent2; c.beginPath(); c.moveTo(-450, yy); c.lineTo(-450 + sw, yy - 10); c.lineTo(-450 + sw, yy + 6); c.closePath(); c.fill();
    c.restore();
  }

  // ---------- alphabet features ----------
  private letterAt(t: number): LetterCue | null { const i = lastBefore(this.letterTimes, t); return i < 0 ? null : this.p.letters[i]; }
  private drawBigLetter(t: number) {
    const L = this.letterAt(t); if (!L || t > L.end) return;
    const c = this.ctx, u = this.u, st = this.p.style, a = t - (L.t - 0.05), dur = L.end - L.t, bridge = L.kind === 'bridge';
    const out = bridge ? 0 : clamp((t - (L.end - 0.22)) / 0.22), inK = easeBack(clamp((a - (bridge ? 0 : 0.28)) / 0.32)); if (inK <= 0) return;
    c.save();
    if (bridge || this.vertical) {
      if (bridge) { c.fillStyle = rgba(st.palette.bg, 0.38); c.fillRect(0, 0, this.W, this.H); }
      c.translate(this.W / 2, this.vertical && !bridge ? this.H * 0.3 : this.H / 2 + 40 * u); const z = (bridge ? 1.35 - 0.35 * inK : 0.8 + 0.2 * inK) * (1 + 0.04 * this.kick(t)) * u * (this.vertical && !bridge ? 0.75 : 1); c.scale(z, z);
      c.globalAlpha = 1 - out; c.font = this.font(st.fonts.display, 620); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 50; c.shadowOffsetY = 18; c.fillStyle = this.foil(c, -260, -300, 260, 300, t * 3); c.fillText(L.ch, 0, 0);
      c.shadowBlur = 0; c.shadowOffsetY = 0; c.font = this.font(st.fonts.lyric, 56); (c as any).letterSpacing = '22px'; c.fillStyle = st.palette.text; c.fillText(L.word, 11, 330); (c as any).letterSpacing = '0px';
      c.restore(); return;
    }
    c.globalAlpha = 1 - out; c.translate(330 * u - out * 120 * u, this.H * 0.5 - 30 * u);
    const z = (0.9 + 0.1 * inK) * (1 + 0.025 * this.kick(t)) * (1 + (a / Math.max(dur, 0.1)) * 0.06) * u; c.scale(z, z); c.rotate(-0.02 * (1 - inK));
    c.font = this.font(st.fonts.display, 560); c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let d = 14; d > 0; d -= 2) { c.fillStyle = 'rgba(30,18,6,.5)'; c.fillText(L.ch, d, d); }
    c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 60; c.shadowOffsetY = 20; c.fillStyle = this.foil(c, -240, -280, 240, 280, t); c.fillText(L.ch, 0, 0);
    c.shadowBlur = 0; c.shadowOffsetY = 0; c.lineWidth = 2; c.strokeStyle = 'rgba(255,240,200,.55)'; c.strokeText(L.ch, 0, 0);
    const k2 = easeOut(clamp((a - 0.45) / 0.35)), idx = L.ch.charCodeAt(0) - 64;
    c.font = this.font(st.fonts.ui, 26); (c as any).letterSpacing = '8px'; c.fillStyle = rgba(st.palette.accent2, k2); c.fillText(`${String(idx).padStart(2, '0')} / 26`, 4, -305);
    c.font = this.font(st.fonts.lyric, 68); (c as any).letterSpacing = `${34 - 20 * k2}px`; c.fillStyle = rgba(st.palette.text, k2); c.fillText(L.word, 10, 300);
    c.fillStyle = rgba(st.palette.accent, k2); c.fillRect(-150 * k2, 340, 300 * k2, 3); (c as any).letterSpacing = '0px'; c.restore(); c.globalAlpha = 1;
  }
  private drawRuler(t: number) {
    if (!this.p.letters.length) return; const first = this.p.letters[0].t - 0.6, c = this.ctx, u = this.u, st = this.p.style;
    if (t < first || t >= this.endStart()) return;
    const vis = clamp((t - first) / 0.6), seen = new Set<string>(); let cur: LetterCue | null = null;
    for (const L of this.p.letters) if (L.t - 0.05 <= t) { seen.add(L.ch); cur = L; }
    const active = cur && t <= cur.end + 0.1 ? cur.ch : null, LB = st.grade.letterbox * u;
    const x0 = this.W * 0.13, x1 = this.W * 0.87, y = LB + 46 * u + (this.vertical ? this.H * 0.05 : 0), step = (x1 - x0) / 25;
    c.save(); c.globalAlpha = vis; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = this.font(st.fonts.ui, (this.vertical ? 20 : 24) * u);
    c.fillStyle = rgba(st.palette.text, 0.14); c.fillRect(x0 - 30 * u, y + 24 * u, x1 - x0 + 60 * u, 1);
    c.fillStyle = st.palette.accent; c.fillRect(x0 - 30 * u, y + 23 * u, (x1 - x0 + 60 * u) * (seen.size / 26), 3 * u);
    for (let i = 0; i < 26; i++) {
      const ch = String.fromCharCode(65 + i), x = x0 + i * step, on = seen.has(ch), act = ch === active;
      if (act && cur) { const p = easeBack(clamp((t - cur.t + 0.05) / 0.25)); c.fillStyle = st.palette.accent2; c.fillRect(x - 19 * u, y - (21 + 4 * p) * u, 38 * u, (42 + 4 * p) * u); }
      c.fillStyle = act ? '#fff' : on ? st.palette.accent : rgba(st.palette.text, 0.28); c.fillText(ch, x, y + u);
    }
    c.restore();
  }

  // ---------- cards ----------
  private introTypeLine(): Line | undefined { const firstHook = this.p.drops[0] ?? 1e9; return [...this.p.lines].reverse().find(l => l.style === 'talk' && l.end < firstHook + 0.1); }
  private drawOpen(t: number) {
    const c = this.ctx, u = this.u, st = this.p.style, P = st.palette, m = this.p.meta;
    const firstCut = this.p.shots[1]?.from ?? 3, k = clamp(t / Math.max(firstCut, 0.5));
    c.fillStyle = rgba(P.bg, 0.82 - 0.25 * easeOut(k)); c.fillRect(0, 0, this.W, this.H);
    const outK = clamp((t - (firstCut - 0.35)) / 0.35); c.save(); c.globalAlpha = 1 - outK;
    if (st.features.dictionaryOpen) {
      const x = this.vertical ? 70 * u : 260 * u, y = this.vertical ? this.H * 0.4 : 410 * u, a1 = easeOut(clamp((t - 0.3) / 0.8));
      const head = (m.definition?.[0]) || m.title.toLowerCase();
      c.textAlign = 'left'; c.font = this.font(st.fonts.display, (this.vertical ? 110 : 150) * u, 'italic'); c.fillStyle = this.foil(c, x, y - 140 * u, x + 900 * u, y, t);
      c.globalAlpha = (1 - outK) * a1; c.fillText(head, x, y + (1 - a1) * 30 * u); c.globalAlpha = 1 - outK;
      const defs = m.definition?.slice(1) ?? [`1.  ${m.artist}.`];
      const typeOn = (text: string, yy: number, t0: number, cps: number, color: string, sz: number) => {
        const n = clamp(Math.floor((t - t0) * cps), 0, text.length); if (n <= 0) return; c.font = this.font(st.fonts.ui, sz * u); c.fillStyle = color; const s = text.slice(0, n); c.fillText(s, x + 6 * u, yy);
        if (n < text.length || Math.floor(t * 2.4) % 2 === 0) { const w = c.measureText(s).width; c.fillStyle = P.accent2; c.fillRect(x + 6 * u + w + 6 * u, yy - 30 * u, 4 * u, 36 * u); } };
      defs.forEach((d, i) => typeOn(d, y + (80 + i * 60) * u + (i > 0 ? 30 * u : 0), 1.0 + i * 1.1, 42, i === 0 ? '#9fb6c9' : i === defs.length - 1 ? P.accent : P.text, i === 0 ? 34 : 30));
      c.fillStyle = rgba(P.accent2, a1); c.fillRect(x, y - 190 * u, 120 * u * a1, 5 * u);
    } else {
      c.textAlign = 'center'; c.textBaseline = 'alphabetic'; const cx = this.W / 2, cy = this.H / 2;
      const a1 = clamp((t - 0.2) / 0.6), a2 = clamp((t - 0.7) / 0.5), a3 = clamp((t - 1.1) / 0.5);
      c.font = this.font(st.fonts.ui, 30 * u); (c as any).letterSpacing = `${(26 - 12 * easeOut(a1)) * u}px`; c.fillStyle = rgba(P.accent, a1); c.fillText(m.artist.toUpperCase(), cx, cy - 125 * u); (c as any).letterSpacing = '0px';
      const words = m.title.split(' '), last = words.length > 1 ? words.pop()! : '', main = words.join(' ');
      c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 30; c.font = this.font(st.fonts.display, (this.vertical ? 120 : 170) * u); c.fillStyle = rgba(P.text, a2); c.fillText(main.toUpperCase(), cx, cy + 50 * u + (1 - easeOut(a2)) * 30 * u);
      if (last) { c.save(); c.translate(cx + 260 * u, cy + 175 * u); c.rotate(-0.06); const s = 0.8 + 0.2 * easeBack(a3); c.scale(s, s); c.font = this.font(st.fonts.hot, 135 * u); c.fillStyle = rgba(P.hot, a3); c.fillText(last, 0, 0); c.restore(); }
      c.shadowBlur = 0;
    }
    c.restore();
  }
  private drawIntroTypeOn(t: number) {
    if (!this.p.style.features.dictionaryOpen) return; const L = this.introTypeLine(); if (!L || t < L.start - 0.1 || t > (this.p.drops[0] ?? L.end + 1)) return;
    const c = this.ctx, u = this.u, P = this.p.style.palette, word = L.words[L.words.length - 1].d.replace(/[^A-Za-z]/g, '').toUpperCase();
    const n = clamp(Math.floor((t - (L.start + 0.25)) / ((L.end - L.start) / word.length)), 0, word.length);
    c.save(); c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = this.font(this.p.style.fonts.lyric, Math.min(190, 1500 / word.length * 1.7) * u * (this.vertical ? 0.55 : 1)); (c as any).letterSpacing = '8px';
    const tw = c.measureText(word).width; let xx = this.W / 2 - tw / 2;
    c.fillStyle = 'rgba(3,4,7,.45)'; c.fillRect(0, 0, this.W, this.H);
    for (let i = 0; i < word.length; i++) { const ch = word[i], cw = c.measureText(ch).width + 8; c.fillStyle = i < n ? (i === n - 1 ? P.accent2 : P.text) : rgba(P.text, 0.12); c.fillText(ch, xx, this.H / 2); xx += cw; }
    c.restore(); (c as any).letterSpacing = '0px';
  }
  private drawDropLockup(t: number) {
    const c = this.ctx, u = this.u, st = this.p.style, title = this.p.meta.title, m = title.match(/^(\S+)\s+(to|&|and|x|vs\.?)\s+(\S+)$/i);
    for (const d of this.p.drops.slice(0, 2)) {
      const a = t - d; if (a < 0 || a > 1.45) continue;
      const k = easeBack(clamp(a / 0.3)), out = clamp((a - 1.15) / 0.3);
      c.save(); c.globalAlpha = 1 - out; c.translate(this.vertical ? this.W / 2 : this.W * 0.31, this.H / 2 - 60 * u); const z = (1.5 - 0.5 * k) * (1 + 0.05 * this.kick(t)) * u * (this.vertical ? 0.7 : 1); c.scale(z, z);
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 50;
      if (m) { c.font = this.font(st.fonts.display, 330); c.fillStyle = this.foil(c, -420, -200, 420, 200, t * 2); c.fillText(m[1], -330, 0); c.fillText(m[3], 330, 0); c.shadowBlur = 0; c.font = this.font(st.fonts.lyric, 120); c.fillStyle = st.palette.text; c.fillText(m[2].toUpperCase(), 0, 10); }
      else { c.font = this.font(st.fonts.display, Math.min(260, 2400 / title.length)); c.fillStyle = this.foil(c, -600, -150, 600, 150, t * 2); c.fillText(title.toUpperCase(), 0, 0); c.shadowBlur = 0; }
      c.fillStyle = st.palette.accent2; c.fillRect(-90, 80, 180, 6); c.restore();
    }
  }
  private drawEnd(t: number) {
    const c = this.ctx, u = this.u, st = this.p.style, P = st.palette, m = this.p.meta, a = t - this.endStart();
    c.fillStyle = P.bg; c.fillRect(0, 0, this.W, this.H);
    const bgShot = [...this.p.shots].reverse().find(s => s.img && this.imgs[s.img]);
    const cover = this.p.plan.coverId ? this.imgs[this.p.plan.coverId] : undefined;
    const bgImg = cover ?? (bgShot ? this.imgs[bgShot.img] : undefined);
    if (bgImg) { (c as any).filter = 'blur(20px) brightness(.4) saturate(.85)'; this.cover(c, bgImg, 1.25 + a * 0.01, 0, 0); (c as any).filter = 'none'; }
    const k = easeOut(clamp(a / 0.9)), k2 = easeOut(clamp((a - 0.5) / 0.7)), k3 = clamp((a - 1.2) / 0.8);
    let cx = this.W / 2;
    if (cover && !this.vertical) {
      const s = 720 * u; c.save(); c.translate(this.W * 0.09 + s / 2, this.H / 2); c.rotate(-0.035 * (1 - k)); c.globalAlpha = k; c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 60;
      c.drawImage(cover, -s / 2, (-s / 2) * cover.height / cover.width, s, (s * cover.height) / cover.width); c.restore(); c.shadowBlur = 0; c.globalAlpha = 1; cx = this.W * 0.68;
    }
    c.save(); c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.font = this.font(st.fonts.ui, 30 * u); (c as any).letterSpacing = `${14 * u}px`; c.fillStyle = rgba(P.accent2, k); c.fillText(m.artist.toUpperCase(), cx + 7 * u, this.H * 0.3); (c as any).letterSpacing = '0px';
    c.globalAlpha = k; c.font = this.font(st.fonts.display, Math.min(260, 3000 / Math.max(4, m.title.length)) * u); c.fillStyle = this.foil(c, cx - 500 * u, this.H * 0.33, cx + 500 * u, this.H * 0.6, t);
    c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 50; c.fillText(m.title.toUpperCase(), cx, this.H * 0.55 + (1 - k) * 40 * u); c.shadowBlur = 0;
    if (m.tagline) { c.globalAlpha = k2; c.font = this.font(st.fonts.hot, 54 * u, 'italic'); c.fillStyle = P.text; c.fillText(m.tagline, cx, this.H * 0.68); }
    if (st.features.ruler) { c.globalAlpha = k3; c.font = this.font(st.fonts.ui, 24 * u); (c as any).letterSpacing = `${9 * u}px`; c.fillStyle = '#9fb6c9'; c.fillText('ABCDEFGHIJKLMNOPQRSTUVWXYZ', cx + 5 * u, this.H * 0.76); (c as any).letterSpacing = '0px'; }
    c.restore(); c.globalAlpha = 1;
  }

  // ---------- atmosphere + grade ----------
  private drawParticles(t: number, mode: string = this.p.style.particles, alpha = 1) {
    const c = this.ctx, W = this.W, H = this.H, u = this.u; if (mode === 'none') return;
    if (mode === 'rays' || mode === 'flare' || mode === 'petals' || mode === 'sparks') return this.drawFx(t, mode, alpha);
    c.save(); c.globalAlpha = alpha;
    c.globalCompositeOperation = mode === 'embers' ? 'lighter' : 'screen';
    if (mode === 'rain') { c.lineWidth = 1.4 * u; for (let i = 0; i < 70; i++) { const sp = 1.1 + hash(i) * 0.9, ph = (t * sp + hash(i + 3)) % 1, x = hash(i + 7) * W * 1.2 - 0.1 * W + ph * 140 * u, y = ph * (H + 200 * u) - 100 * u; c.strokeStyle = `rgba(190,215,235,${0.07 + 0.08 * hash(i + 9)})`; c.beginPath(); c.moveTo(x, y); c.lineTo(x - 14 * u, y - 46 * u); c.stroke(); } }
    else if (mode === 'embers') { for (let i = 0; i < 26; i++) { const life = 1.8 + hash(i + 11) * 2.6, ph = ((t + hash(i) * life) % life) / life; const x = (hash(i + 2) + Math.sin(t * 2 + i) * 0.012) * W, y = (1.04 - ph * (0.45 + hash(i + 5) * 0.45)) * H; const s = (2 + hash(i + 6) * 3) * u, a = 0.7 * (1 - ph) * (0.6 + 0.4 * Math.sin(t * 20 + i)); c.fillStyle = `rgba(255,${(150 + hash(i + 8) * 90) | 0},60,${a})`; c.fillRect(x, y, s, s); c.globalAlpha = a * 0.4; c.drawImage(this.glow, x - s * 3, y - s * 3, s * 6, s * 6); c.globalAlpha = 1; } }
    else if (mode === 'snow') { for (let i = 0; i < 90; i++) { const sp = 0.08 + hash(i) * 0.1, ph = (t * sp + hash(i + 3)) % 1, x = (hash(i + 7) + Math.sin(t * 0.8 + i) * 0.01) * W, y = ph * (H + 40) - 20, s = (1.5 + hash(i + 4) * 3) * u; c.fillStyle = `rgba(255,255,255,${0.35 + 0.4 * hash(i + 2)})`; c.beginPath(); c.arc(x, y, s, 0, 7); c.fill(); } }
    else if (mode === 'dust') { for (let i = 0; i < 40; i++) { const x = (hash(i + 1) + 0.02 * Math.sin(t * 0.3 + i)) * W, y = (hash(i + 2) + 0.02 * Math.cos(t * 0.25 + i * 2)) * H, s = (1 + hash(i + 3) * 2.5) * u; c.globalAlpha = 0.25 + 0.25 * Math.sin(t * 2 + i); c.drawImage(this.glow, x - s * 3, y - s * 3, s * 6, s * 6); } c.globalAlpha = 1; }
    c.restore();
  }
  /** Cinematic overlays chosen per scene: god rays, anamorphic flare sweeps, falling rose petals, rising sparks. Deterministic in t. */
  private drawFx(t: number, mode: string, alpha = 1) {
    const c = this.ctx, W = this.W, H = this.H, u = this.u;
    c.save(); c.globalAlpha = alpha;
    if (mode === 'rays') {
      c.globalCompositeOperation = 'screen';
      const ox = W * 0.18, oy = -H * 0.15;
      for (let i = 0; i < 9; i++) {
        const a = 0.35 + i * 0.11 + Math.sin(t * 0.25 + i * 1.7) * 0.03, w = 0.035 + 0.03 * hash(i + 4), len = H * 1.9;
        const g = c.createLinearGradient(ox, oy, ox + Math.cos(a) * len, oy + Math.sin(a) * len);
        const k = (0.05 + 0.06 * hash(i)) * (0.75 + 0.25 * Math.sin(t * 0.7 + i));
        g.addColorStop(0, `rgba(255,214,150,${k})`); g.addColorStop(1, 'rgba(255,214,150,0)');
        c.fillStyle = g; c.beginPath(); c.moveTo(ox, oy);
        c.lineTo(ox + Math.cos(a - w) * len, oy + Math.sin(a - w) * len); c.lineTo(ox + Math.cos(a + w) * len, oy + Math.sin(a + w) * len); c.closePath(); c.fill();
      }
    } else if (mode === 'flare') {
      c.globalCompositeOperation = 'lighter';
      const ph = (t * 0.09) % 1, x = (-0.2 + ph * 1.4) * W, y = H * (0.3 + 0.08 * Math.sin(t * 0.2));
      const g = c.createLinearGradient(x - W * 0.5, y, x + W * 0.5, y);
      g.addColorStop(0, 'rgba(120,170,255,0)'); g.addColorStop(0.5, 'rgba(170,205,255,0.32)'); g.addColorStop(1, 'rgba(120,170,255,0)');
      c.fillStyle = g; c.fillRect(x - W * 0.5, y - 2.2 * u, W, 4.4 * u);
      c.globalAlpha = alpha * 0.55; c.drawImage(this.glow, x - 70 * u, y - 70 * u, 140 * u, 140 * u);
      for (let i = 1; i <= 4; i++) { const gx = W / 2 + (W / 2 - x) * (0.35 * i), gy = H / 2 + (H / 2 - y) * (0.35 * i), r = (10 + 14 * i) * u; c.globalAlpha = alpha * 0.12; c.drawImage(this.glow, gx - r, gy - r, r * 2, r * 2); }
    } else if (mode === 'petals') {
      for (let i = 0; i < 26; i++) {
        const sp = 0.06 + hash(i) * 0.07, ph = (t * sp + hash(i + 3)) % 1, x = (hash(i + 7) + Math.sin(t * 0.9 + i) * 0.04 + ph * 0.12) * W, y = ph * (H + 80 * u) - 40 * u;
        const s = (7 + hash(i + 4) * 8) * u, rot = t * (0.8 + hash(i + 5)) + i;
        c.save(); c.translate(x, y); c.rotate(rot); c.scale(1, 0.55 + 0.45 * Math.sin(t * 2.3 + i));
        c.fillStyle = `rgba(${170 + (hash(i + 9) * 50) | 0},${20 + (hash(i + 1) * 30) | 0},${40 + (hash(i + 2) * 30) | 0},0.85)`;
        c.beginPath(); c.ellipse(0, 0, s, s * 0.62, 0, 0, Math.PI * 2); c.fill(); c.restore();
      }
    } else if (mode === 'sparks') {
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 60; i++) {
        const life = 0.9 + hash(i + 11) * 1.4, ph = ((t + hash(i) * life) % life) / life;
        const x = (0.5 + (hash(i + 2) - 0.5) * 0.9 + (hash(i + 6) - 0.5) * ph * 0.25) * W, y = (0.95 - ph * (0.5 + hash(i + 5) * 0.5) + ph * ph * 0.25) * H;
        const s = (1.5 + hash(i + 6) * 2.5) * u, a = (1 - ph) * (0.7 + 0.3 * Math.sin(t * 30 + i));
        c.fillStyle = `rgba(255,${(170 + hash(i + 8) * 70) | 0},90,${a})`; c.fillRect(x, y, s, s * 2.5);
        c.globalAlpha = alpha * a * 0.35; c.drawImage(this.glow, x - s * 4, y - s * 4, s * 8, s * 8); c.globalAlpha = alpha;
      }
    }
    c.restore();
  }
  private sceneFx(img: string) { return this.p.scenes.find(s => s.id === img)?.fx ?? []; }

  private grade(t: number, f: number) {
    const c = this.ctx, st = this.p.style, G = st.grade, P = st.palette, W = this.W, H = this.H, u = this.u, k = this.kick(t);
    if (G.bloom > 0) {
      const bw = this.bloom.width, bh = this.bloom.height, b1 = this.bloom.getContext('2d') as Ctx, b2 = this.bloom2.getContext('2d') as Ctx;
      (b1 as any).filter = 'brightness(0.7) contrast(2.7)'; b1.drawImage(this.cv as any, 0, 0, bw, bh); (b1 as any).filter = 'none';
      b2.clearRect(0, 0, bw, bh); (b2 as any).filter = 'blur(9px)'; b2.drawImage(this.bloom, 0, 0); (b2 as any).filter = 'none';
      c.globalCompositeOperation = 'screen'; c.globalAlpha = G.bloom; c.drawImage(this.bloom2, 0, 0, W, H); c.globalAlpha = 1;
    }
    if (G.lightLeak > 0) { const lx = (0.5 + 0.45 * Math.sin(t * 0.21)) * W, ly = (0.3 + 0.2 * Math.cos(t * 0.17)) * H; c.globalCompositeOperation = 'screen'; c.globalAlpha = G.lightLeak; const lr = c.createRadialGradient(lx, ly, 0, lx, ly, 900 * u); lr.addColorStop(0, `rgba(${G.leakColor},.9)`); lr.addColorStop(1, `rgba(${G.leakColor},0)`); c.fillStyle = lr; c.fillRect(0, 0, W, H); c.globalAlpha = 1; }
    c.globalCompositeOperation = 'soft-light'; const sg = c.createLinearGradient(0, H, W * 0.3, 0); sg.addColorStop(0, P.shadowTint); sg.addColorStop(1, P.highlightTint); c.fillStyle = sg; c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
    // drops
    for (const d of this.p.drops) {
      const a = t - d; if (a < 0 || a > 0.3 || st.transitions.drop === 'none') continue; const e = 1 - a / 0.3;
      if (st.transitions.drop === 'flash-rgb') { c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.28 * e; (c as any).filter = 'sepia(1) hue-rotate(-50deg) saturate(6)'; c.drawImage(this.cv as any, 14 * u * e, 0); (c as any).filter = 'sepia(1) hue-rotate(160deg) saturate(6)'; c.drawImage(this.cv as any, -14 * u * e, 0); (c as any).filter = 'none'; c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; }
      c.fillStyle = `rgba(255,248,238,${0.88 * Math.pow(e, 2)})`; c.fillRect(0, 0, W, H);
    }
    // section transitions
    for (const sec of this.p.sections) {
      const b = sec[1]; if (b <= 0 || this.p.drops.some(x => Math.abs(x - b) < 0.3)) continue; const d = t - b; const mode = st.transitions.section;
      if (mode === 'film-burn' && d > -0.35 && d < 0.5) { const e = d < 0 ? 1 + d / 0.35 : 1 - d / 0.5, cx = W * (0.25 + 0.5 * hash(b)), cy = H * (0.3 + 0.4 * hash(b + 1)); c.globalCompositeOperation = 'screen'; const fb = c.createRadialGradient(cx, cy, 0, cx, cy, W * (0.4 + 0.5 * e)); fb.addColorStop(0, `rgba(255,235,200,${0.95 * e})`); fb.addColorStop(0.35, `rgba(${G.leakColor},${0.8 * e})`); fb.addColorStop(1, 'rgba(200,40,10,0)'); c.fillStyle = fb; c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'source-over'; }
      else if (mode === 'light-sweep' && d > -0.25 && d < 0.4) { const e = d < 0 ? 1 + d / 0.25 : 1 - d / 0.4, x = lerp(-0.3, 1.3, clamp((d + 0.25) / 0.65)) * W; const g = c.createLinearGradient(x - 500 * u, 0, x + 500 * u, 0); g.addColorStop(0, rgba(P.accent, 0)); g.addColorStop(0.5, rgba(P.accent, 0.7 * e)); g.addColorStop(1, rgba(P.accent, 0)); c.globalCompositeOperation = 'screen'; c.fillStyle = g; c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'source-over'; }
      else if (mode === 'flash' && d >= 0 && d < 0.18) { c.fillStyle = `rgba(255,255,255,${0.7 * (1 - d / 0.18)})`; c.fillRect(0, 0, W, H); }
    }
    if (this.big(t)) { c.globalCompositeOperation = 'screen'; c.fillStyle = rgba(P.accent, 0.06 * k); c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'source-over'; }
    const vg = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.4, W / 2, H / 2, Math.max(W, H) * 0.62); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${G.vignette})`); c.fillStyle = vg; c.fillRect(0, 0, W, H);
    if (G.grain > 0) { c.globalCompositeOperation = 'overlay'; c.globalAlpha = G.grain; c.drawImage(this.grain[f % 4], 0, 0, W, H); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; }
    const LB = G.letterbox * u * easeOut(clamp((t - 0.2) / 1.3)); if (LB > 0) { c.fillStyle = '#000'; c.fillRect(0, 0, W, LB); c.fillRect(0, H - LB, W, LB); }
    if (st.features.footer && LB > 20 * u && t > 1.5 && t < this.endStart()) {
      c.fillStyle = rgba(P.accent, 0.35); c.fillRect(0, LB, W, 1); c.fillRect(0, H - LB - 1, W, 1);
      c.font = this.font(st.fonts.ui, 18 * u); (c as any).letterSpacing = `${6 * u}px`; c.fillStyle = rgba(P.text, 0.5); c.textAlign = 'left';
      c.fillText(this.p.meta.footer ?? `${this.p.meta.artist} — ${this.p.meta.title}`.toUpperCase(), 60 * u, H - LB / 2 + 6 * u);
      const L = this.letterAt(t); if (L) { c.textAlign = 'right'; c.fillText(`${L.ch}/Z`, W - 60 * u, H - LB / 2 + 6 * u); } c.textAlign = 'left'; (c as any).letterSpacing = '0px';
    }
    const dur = this.p.analysis?.dur ?? 0; if (dur && t > dur - 2.2) { c.fillStyle = `rgba(0,0,0,${clamp((t - (dur - 2.2)) / 2)})`; c.fillRect(0, 0, W, H); }
  }

  renderAt(t: number) {
    const c = this.ctx, f = Math.round(t * this.p.fps), st = this.p.style;
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; (c as any).filter = 'none'; c.shadowBlur = 0; (c as any).letterSpacing = '0px';
    c.fillStyle = '#000'; c.fillRect(0, 0, this.W, this.H);
    if (!this.p.shots.length) return;
    const shot = this.shotAt(t), J = this.jolt(t);
    c.save(); c.translate(this.W / 2 + J.x, this.H / 2 + J.y); c.scale(J.z, J.z); c.translate(-this.W / 2, -this.H / 2);   // one rigid camera knock for the whole frame
    if (shot.kind === 'end') this.drawEnd(t);
    else {
      this.drawShot(shot, t);
      if (shot.kind === 'open') this.drawOpen(t);
      if (st.features.captions) this.drawCaption(shot, t);
      this.drawParticles(t);
      { const a = clamp((t - shot.from) / 0.25); for (const fx of this.sceneFx(shot.img)) this.drawParticles(t, fx, a); }
      if (st.features.signs) this.drawSigns(t, shot);
      if (st.features.bigLetters) this.drawBigLetter(t);
      this.drawIntroTypeOn(t);
      if (st.features.dropLockup) this.drawDropLockup(t);
      if (!(shot.kind === 'open' && st.features.dictionaryOpen)) this.drawLyrics(t);
      if (st.features.stamps) this.drawStamp(t);
    }
    c.restore();
    this.grade(t, f);
    if (st.features.ruler) this.drawRuler(t);
  }
}

function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function shade(hex: string, amt: number) {
  const n = parseInt(hex.replace('#', ''), 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (v: number) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
  r = f(r); g = f(g); b = f(b); return `rgb(${r},${g},${b})`;
}
