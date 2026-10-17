// Deterministic music analysis (no AI): onset envelope, tempo, beat tracking (Ellis 2007 DP),
// kick/snare onsets and a loudness curve. Pure TypeScript, runs in the browser, a worker or Node.
import type { Analysis } from './types';

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function peaks(env: Float64Array, hopT: number, minGap: number, k: number, off = 0): number[] {
  // adaptive threshold: local mean + k * local std over +/- 1.5 s
  const out: number[] = [], w = Math.round(1.5 / hopT);
  const pre = new Float64Array(env.length + 1), pre2 = new Float64Array(env.length + 1);
  for (let i = 0; i < env.length; i++) { pre[i + 1] = pre[i] + env[i]; pre2[i + 1] = pre2[i] + env[i] * env[i]; }
  let last = -1e9;
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] < env[i - 1] || env[i] < env[i + 1]) continue;
    const a = Math.max(0, i - w), b = Math.min(env.length, i + w), n = b - a;
    const mean = (pre[b] - pre[a]) / n, sd = Math.sqrt(Math.max(0, (pre2[b] - pre2[a]) / n - mean * mean));
    if (env[i] > mean + k * sd && env[i] > 0.02) {
      const t = i * hopT + off;
      if (t - last >= minGap) { out.push(+t.toFixed(3)); last = t; }
    }
  }
  return out;
}

const LAG = 1024 / 22050;   // librosa onset_strength(center=True) adds n_fft/(2*hop) frames of lag; match it
export function analyze(samples: Float32Array, sr: number, onProgress?: (p: number) => void): Analysis {
  const N = 2048, hop = 512, hopT = hop / sr, frames = Math.max(1, Math.floor((samples.length - N) / hop));
  const win = new Float64Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const bins = N / 2, binHz = sr / N;
  const band = (lo: number, hi: number) => [Math.max(1, Math.floor(lo / binHz)), Math.min(bins - 1, Math.ceil(hi / binHz))];
  const [l0, l1] = band(20, 150), [s0, s1] = band(1500, 5000);
  const flux = new Float64Array(frames), low = new Float64Array(frames), snr = new Float64Array(frames), rmsF = new Float64Array(frames);
  let prev = new Float64Array(bins);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    const o = f * hop; let e = 0;
    for (let i = 0; i < N; i++) { const v = samples[o + i] || 0; re[i] = v * win[i]; im[i] = 0; e += v * v; }
    rmsF[f] = Math.sqrt(e / N);
    fft(re, im);
    const mag = new Float64Array(bins); let fl = 0, lo = 0, sn = 0;
    for (let k = 1; k < bins; k++) {
      const m = Math.log1p(100 * Math.hypot(re[k], im[k]));
      mag[k] = m; const d = m - prev[k]; if (d > 0) fl += d;
      if (k >= l0 && k <= l1) lo += m; if (k >= s0 && k <= s1) sn += m;
    }
    flux[f] = fl; low[f] = lo; snr[f] = sn; prev = mag;
    if (onProgress && f % 500 === 0) onProgress(f / frames * 0.7);
  }
  const norm = (a: Float64Array) => { let mx = 1e-9; for (const v of a) mx = Math.max(mx, v); for (let i = 0; i < a.length; i++) a[i] /= mx; return a; };
  const diffPos = (a: Float64Array) => { const o = new Float64Array(a.length); for (let i = 1; i < a.length; i++) o[i] = Math.max(0, a[i] - a[i - 1]); return norm(o); };
  norm(flux);
  // ---- tempo: autocorrelation of onset envelope with a log-normal prior around 110 BPM ----
  const minLag = Math.round(60 / 200 / hopT), maxLag = Math.round(60 / 55 / hopT);
  let best = minLag, bestScore = -1;
  const mean = flux.reduce((a, b) => a + b, 0) / flux.length;
  const acAt = (lag: number) => { let ac = 0; for (let i = lag; i < flux.length; i++) ac += (flux[i] - mean) * (flux[i - lag] - mean); return ac; };
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 / (lag * hopT), prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 110) / 0.9, 2));
    const sc = acAt(lag) * prior; if (sc > bestScore) { bestScore = sc; best = lag; }
  }
  // sub-frame refinement of the period (parabolic peak interpolation) for an accurate BPM readout
  const a0 = acAt(best - 1), a1 = acAt(best), a2 = acAt(best + 1), den = a0 - 2 * a1 + a2;
  const fine = best + (den !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a0 - a2) / den)) : 0);
  const tempo = 60 / (fine * hopT);
  onProgress?.(0.8);
  // ---- beat tracking: dynamic programming (Ellis 2007) ----
  const P = best, alpha = 100, score = new Float64Array(flux.length), back = new Int32Array(flux.length).fill(-1);
  const localEnv = new Float64Array(flux.length);
  { // smooth onset envelope with a gaussian of width ~P/32
    const sd = Math.max(1, P / 32), r = Math.ceil(3 * sd);
    for (let i = 0; i < flux.length; i++) { let s = 0, w = 0; for (let j = -r; j <= r; j++) { const k = i + j; if (k < 0 || k >= flux.length) continue; const g = Math.exp(-0.5 * (j / sd) ** 2); s += flux[k] * g; w += g; } localEnv[i] = s / w; }
  }
  for (let t = 0; t < flux.length; t++) {
    let bestPrev = -1, bestVal = -Infinity;
    for (let p = t - 2 * P; p <= t - Math.round(P / 2); p++) {
      if (p < 0) continue;
      const v = score[p] - alpha * Math.pow(Math.log((t - p) / P), 2);
      if (v > bestVal) { bestVal = v; bestPrev = p; }
    }
    score[t] = localEnv[t] + (bestPrev >= 0 ? bestVal : 0); back[t] = bestPrev;
  }
  let t = 0, mx = -Infinity; for (let i = Math.max(0, flux.length - 2 * P); i < flux.length; i++) if (score[i] > mx) { mx = score[i]; t = i; }
  const beatsF: number[] = []; while (t >= 0) { beatsF.push(t); t = back[t]; }
  const OFF = N / 2 / sr + LAG;   // frame time = window centre (+ empirical flux lag), matching librosa
  const beats = beatsF.reverse().map(f => +(f * hopT + OFF).toFixed(3));
  onProgress?.(0.9);
  const kicks = peaks(diffPos(norm(low)), hopT, 0.22, 1.2, OFF);
  const snares = peaks(diffPos(norm(snr)), hopT, 0.18, 1.4, OFF);
  // loudness curve at ~10 Hz
  const step = Math.max(1, Math.round(0.1 / hopT)), rms: number[] = []; let rmx = 1e-9;
  for (let i = 0; i < rmsF.length; i += step) { let s = 0; for (let j = i; j < Math.min(rmsF.length, i + step); j++) s = Math.max(s, rmsF[j]); rms.push(s); rmx = Math.max(rmx, s); }
  onProgress?.(1);
  return { dur: +(samples.length / sr).toFixed(3), tempo: +tempo.toFixed(2), beats, kicks, snares, rms: rms.map(v => +(v / rmx).toFixed(3)), curveDt: step * hopT };
}

// Browser helper: decode any audio file and resample to mono 22.05 kHz for analysis.
export async function decodeForAnalysis(file: Blob, sr = 22050): Promise<{ samples: Float32Array; sr: number; buffer: AudioBuffer }> {
  const ab = await file.arrayBuffer();
  const ctx = new AudioContext();
  const buffer = await ctx.decodeAudioData(ab.slice(0));
  await ctx.close();
  const off = new OfflineAudioContext(1, Math.ceil(buffer.duration * sr), sr);
  const src = off.createBufferSource(); src.buffer = buffer; src.connect(off.destination); src.start();
  const rendered = await off.startRendering();
  return { samples: rendered.getChannelData(0), sr, buffer };
}
