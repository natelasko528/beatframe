import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import * as A from '../pipeline';

// The production board: the song's real waveform fills in as each stage completes; scenes land on it as they're made.
export function Producing() {
  const run = useStore(s => s.run), err = useStore(s => s.runError), p = useStore(s => s.project), blobs = useStore(s => s.blobs), spend = useStore(s => s.spend), set = useStore(s => s.set);
  const cv = useRef<HTMLCanvasElement>(null);
  const done = run.filter(s => s.status === 'done' || s.status === 'skip').length, frac = done / run.length;
  useEffect(() => {
    const c = cv.current; if (!c) return; const g = c.getContext('2d')!; const dpr = window.devicePixelRatio || 1; const W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr; g.scale(dpr, dpr); g.clearRect(0, 0, W, H);
    const an = p.analysis; const n = 180;
    for (let i = 0; i < n; i++) {
      const v = an ? an.rms[Math.floor((i / n) * an.rms.length)] ?? 0 : 0.15 + 0.1 * Math.abs(Math.sin(i * 0.37));
      const h = Math.max(3, v * H * 0.86), x = (i / n) * W;
      g.fillStyle = i / n <= frac ? (i % 7 === 0 ? '#ffb347' : '#ff3d7f') : 'rgba(243,241,236,.16)';
      g.fillRect(x, (H - h) / 2, Math.max(1.5, W / n - 2), h);
    }
    if (an) { g.fillStyle = 'rgba(243,241,236,.5)'; g.font = '600 11px "Archivo Variable"'; p.sections.forEach(s => { const x = (s[1] / an.dur) * W; g.fillRect(x, 0, 1, 8); g.fillText(s[0], x + 4, 10); }); }
  }, [p.analysis, p.sections, frac]);
  const scenes = p.scenes;
  return (
    <main className="producing">
      <header className="prod-head">
        <p className="brand">BeatFrame</p>
        <div><h1>{p.meta.title}</h1>{p.meta.artist && <p className="sub">{p.meta.artist}</p>}</div>
        <p className="spend" title="Spent so far on your own keys">AI ${spend.ai.toFixed(3)} · images ${spend.images.toFixed(2)}</p>
      </header>
      <canvas ref={cv} className="prod-wave" aria-label="Song waveform, fills in as the video is made" />
      <div className="prod-grid">
        <ol className="steps">
          {run.map(s => <li key={s.id} className={`st-${s.status}`}><span className="dot" aria-hidden="true" /><div><b>{s.label}</b>{s.detail && <small>{s.detail}</small>}</div></li>)}
        </ol>
        <div className="prod-right">
          {p.direction && <article className="concept"><h2>{p.direction.concept}</h2><p>{p.direction.world}</p>
            <div className="swatches">{Object.values(p.direction.palette).map((c, i) => <span key={i} style={{ background: c }} title={c} />)}</div>
            <p className="fonts">{p.direction.fonts.lyric} · {p.direction.fonts.display} · {p.direction.mood}</p></article>}
          {scenes.length > 0 && <div className="thumbs-grid">{scenes.map(s => <figure key={s.id} className={`th th-${s.status ?? 'idle'}`}>{blobs[s.id] ? <img src={URL.createObjectURL(blobs[s.id])} alt={s.idea ?? s.id} /> : <span>{s.idea ? s.idea.slice(0, 70) + '…' : s.id}</span>}</figure>)}</div>}
        </div>
      </div>
      {err && <div className="prod-err" role="alert"><p>{err}</p><button onClick={() => set({ screen: 'start' })}>Back</button>{p.shots.length > 0 && <button className="cta" onClick={() => set({ screen: 'studio' })}>Open what's ready</button>}</div>}
      {!err && <button className="linkish" onClick={() => A.resetProject()}>Cancel</button>}
    </main>
  );
}
