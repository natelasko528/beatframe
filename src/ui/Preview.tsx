import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { Renderer } from '../engine/renderer';
import { ClipBank } from '../engine/clips';
import { clipBlobs } from '../pipeline';

// Live preview: the same deterministic renderer as export, driven by the <audio> clock.
export function Preview({ audioRef }: { audioRef: React.RefObject<HTMLAudioElement> }) {
  const cv = useRef<HTMLCanvasElement>(null), rr = useRef<Renderer | null>(null);
  const project = useStore(s => s.project), images = useStore(s => s.images);
  const vertical = project.height > project.width;
  const PW = vertical ? 540 : 1280, PH = vertical ? 960 : 720;   // preview at reduced res, same layout math

  useEffect(() => {
    if (!cv.current) return;
    const p = { ...project, width: PW, height: PH };
    if (!rr.current || rr.current.W !== PW || rr.current.H !== PH) rr.current = new Renderer(cv.current, p, images as any);
    else { rr.current.setProject(p); rr.current.imgs = images as any; }
    rr.current.setClips(Object.keys(clipBlobs()).length ? new ClipBank(clipBlobs()) : null);
    const t0 = useStore.getState().time; rr.current.prepare(t0).then(() => rr.current?.renderAt(t0));
    rr.current.renderAt(t0);
  }, [project, images, PW, PH]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const a = audioRef.current;
      if (a && rr.current) {
        const t = a.paused ? useStore.getState().time : a.currentTime;
        if (!a.paused) useStore.setState({ time: t });
        rr.current.prepare(t);            // video clips decode in the background; the newest frame is drawn
        rr.current.renderAt(t);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [audioRef]);

  return (
    <div className={`preview ${vertical ? 'is-vertical' : ''}`}>
      <canvas ref={cv} width={PW} height={PH} aria-label="Video preview" />
      {!project.shots.length && <p className="preview-empty">No shots yet.</p>}
    </div>
  );
}
