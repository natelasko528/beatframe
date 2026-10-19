// Video clips for scenes (e.g. from Wan 2.2 image-to-video). Decoded frame-accurately with WebCodecs (mediabunny),
// one frame at a time, so a 4-minute video never holds more than a couple of decoded frames per clip in memory.
import { Input, ALL_FORMATS, BlobSource, CanvasSink } from 'mediabunny';

type Frame = CanvasImageSource & { width: number; height: number };
interface Entry { sink: CanvasSink; dur: number; frame?: Frame; at: number }

/** Asset id of a scene's video clip. */
export const clipId = (imgId: string) => `${imgId}~clip`;

/** Where in the clip a shot is at `a` seconds in: plays at real speed (slowed a little for long shots), ping-pongs if the shot outlasts it. */
export function clipTime(a: number, shotLen: number, clipDur: number) {
  if (clipDur <= 0) return 0;
  const rate = Math.max(0.6, Math.min(1, clipDur / Math.max(shotLen, 0.1)));
  const x = a * rate, period = clipDur * 2;
  const m = ((x % period) + period) % period;
  return Math.min(clipDur - 1 / 60, m <= clipDur ? m : period - m);
}

export class ClipBank {
  private e = new Map<string, Entry>(); private loading = new Map<string, Promise<Entry | null>>();
  constructor(private blobs: Record<string, Blob>) {}
  has(id: string) { return !!this.blobs[id]; }
  duration(id: string) { return this.e.get(id)?.dur ?? 0; }
  /** Last decoded frame for this clip (sync; used by the renderer). */
  frame(id: string) { return this.e.get(id)?.frame; }
  private open(id: string) {
    let p = this.loading.get(id);
    if (!p) {
      p = (async () => {
        try {
          const input = new Input({ source: new BlobSource(this.blobs[id]), formats: ALL_FORMATS });
          const track = await input.getPrimaryVideoTrack(); if (!track || !(await track.canDecode())) return null;   // undecodable → scene falls back to its still
          const ent: Entry = { sink: new CanvasSink(track, { poolSize: 2 }), dur: await input.computeDuration(), at: -1 };
          this.e.set(id, ent); return ent;
        } catch { return null; }
      })();
      this.loading.set(id, p);
    }
    return p;
  }
  /** Decode the frame at clip time `ct` (seconds) so `frame(id)` returns it. */
  async seek(id: string, ct: number) {
    const ent = await this.open(id); if (!ent) return;
    if (Math.abs(ent.at - ct) < 1 / 120 && ent.frame) return;
    try { const w = await ent.sink.getCanvas(Math.max(0, ct)); if (w) { ent.frame = w.canvas as Frame; ent.at = ct; } } catch { /* keep the last good frame */ }
  }
  async durationOf(id: string) { return (await this.open(id))?.dur ?? 0; }
}
