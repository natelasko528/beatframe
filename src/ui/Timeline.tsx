import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

// The edit at a glance: loudness, beats, sections, shots (as a film strip), lyric lines and the playhead.
const SEC_COLORS: Record<string, string> = { open: '#3a3f4b', intro: '#4a4f5c', hook: '#c9861a', verse: '#3f6f8f', bridge: '#8f4f8f', outro: '#4a4f5c', end: '#2b2e35', chant: '#c9861a', verse3: '#3f6f8f' };

export function Timeline({ seek }: { seek: (t: number) => void }) {
  const cv = useRef<HTMLCanvasElement>(null); const wrap = useRef<HTMLDivElement>(null);
  const project = useStore(s => s.project), images = useStore(s => s.images), time = useStore(s => s.time);
  const [zoom, setZoom] = useState(1); const [w, setW] = useState(1200);
  const dur = project.analysis?.dur ?? 0;
  useEffect(() => { const ro = new ResizeObserver(e => setW(e[0].contentRect.width)); if (wrap.current) ro.observe(wrap.current); return () => ro.disconnect(); }, []);
  const width = Math.max(w, w * zoom), H = 168;
  useEffect(() => {
    const c = cv.current; if (!c || !dur) return; const g = c.getContext('2d')!; const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr; c.height = H * dpr; g.scale(dpr, dpr); g.clearRect(0, 0, width, H);
    const X = (t: number) => (t / dur) * width;
    // sections
    project.sections.forEach((s, i) => { const x0 = X(s[1]), x1 = X(project.sections[i + 1]?.[1] ?? dur); g.fillStyle = SEC_COLORS[s[0]] ?? '#3a3f4b'; g.fillRect(x0, 0, x1 - x0, 14); g.fillStyle = '#e9e4d8'; g.font = '600 10px "Archivo Variable"'; if (x1 - x0 > 40) g.fillText(s[0], x0 + 5, 10.5); });
    // waveform (loudness)
    const A = project.analysis!; g.fillStyle = '#5c6270';
    A.rms.forEach((v, i) => { const x = X(i * A.curveDt), h = v * 34; g.fillRect(x, 50 - h, Math.max(1, X(A.curveDt) - 0.5), h * 2); });
    // beats + kicks
    g.fillStyle = 'rgba(233,228,216,.22)'; A.beats.forEach(b => g.fillRect(X(b), 16, 1, 68));
    g.fillStyle = '#ffb000'; A.kicks.forEach(k => g.fillRect(X(k), 80, 1.5, 4));
    // shots as film strip
    project.shots.forEach(s => {
      const x0 = X(s.from), x1 = X(s.to), im = images[s.img];
      g.fillStyle = '#121317'; g.fillRect(x0, 88, x1 - x0, 44);
      if (im && x1 - x0 > 3) { g.save(); g.beginPath(); g.rect(x0 + 1, 89, x1 - x0 - 2, 42); g.clip(); const sc = 42 / im.height; g.drawImage(im, x0 + (x1 - x0) / 2 - (im.width * sc) / 2, 89, im.width * sc, 42); g.restore(); }
      else { g.fillStyle = s.kind === 'end' || s.kind === 'open' ? '#2b2e35' : '#262931'; g.fillRect(x0 + 1, 89, x1 - x0 - 2, 42); }
      if (s.letter && x1 - x0 > 12) { g.fillStyle = '#ffb000'; g.font = '700 12px "Archivo Variable"'; g.fillText(s.letter, x0 + 4, 102); }
      g.fillStyle = s.drop ? '#ff5a3c' : '#0b0c0f'; g.fillRect(x0, 88, s.drop ? 2 : 1, 44);
    });
    // lyric lines
    project.lines.forEach(l => { const x0 = X(l.start), x1 = X(l.end); g.fillStyle = l.style === 'hook' ? 'rgba(201,134,26,.75)' : 'rgba(91,140,255,.55)'; g.fillRect(x0, 138, Math.max(2, x1 - x0), 10); if (x1 - x0 > 50) { g.fillStyle = '#e9e4d8'; g.font = '500 10px "Archivo Variable"'; g.save(); g.beginPath(); g.rect(x0, 148, x1 - x0, 16); g.clip(); g.fillText(l.text, x0 + 2, 161); g.restore(); } });
  }, [project, images, width, dur]);
  if (!dur) return <div className="timeline is-empty" ref={wrap}><span>The timeline appears once a song is loaded.</span></div>;
  const px = (time / dur) * width;
  const onPointer = (e: React.PointerEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); seek(Math.max(0, Math.min(dur, ((e.clientX - r.left) / width) * dur))); };
  return (
    <div className="timeline" ref={wrap}>
      <div className="timeline-scroll" onPointerDown={e => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); onPointer(e); }} onPointerMove={e => e.buttons && onPointer(e)}>
        <div style={{ width, position: 'relative' }}>
          <canvas ref={cv} style={{ width, height: H, display: 'block' }} />
          <div className="playhead" style={{ left: px }} />
        </div>
      </div>
      <label className="zoom">Zoom <input type="range" min={1} max={12} step={0.5} value={zoom} onChange={e => setZoom(+e.target.value)} /></label>
    </div>
  );
}
