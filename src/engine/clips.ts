// Video clips for scenes (e.g. from Wan 2.2 image-to-video). Decoded frame-accurately with WebCodecs (mediabunny),
// one frame at a time, so a 4-minute video never holds more than a couple of decoded frames per clip in memory.
import { Input, ALL_FORMATS, BlobSource, CanvasSink } from 'mediabunny';

type Frame = CanvasImageSource & { width: number; height: number };
interface Entry { sink: CanvasSink; dur: number; frame?: Frame; at: number; it?: AsyncGenerator<any>; next?: any }

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
  private e = new Map<string, Entry>(); private loading = new Map<string, Promise<Entry | null>>(); private used: string[] = [];
  private static KEEP = 4;   // open decoders at once; older ones are closed so a long video never piles up memory
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
          const ent: Entry = { sink: new CanvasSink(track, { poolSize: 3 }), dur: await input.computeDuration(), at: -1 };
          this.e.set(id, ent); return ent;
        } catch { return null; }
      })();
      this.loading.set(id, p);
    }
    return p;
  }
  /** Decode the frame at clip time `ct` (seconds) so `frame(id)` returns it.
   *  Plays forward with one running decoder (cheap); only jumps backward or far ahead restart it from the nearest keyframe. */
  async seek(id: string, ct: number) {
    this.used = [id, ...this.used.filter(x => x !== id)];
    for (const old of this.used.splice(ClipBank.KEEP)) this.close(old);
    const ent = await this.open(id); if (!ent) return;
    ct = Math.max(0, ct);
    if (Math.abs(ent.at - ct) < 1 / 120 && ent.frame) return;
    try {
      if (!ent.it || ct < ent.at - 1e-3 || ct - ent.at > 1.0) {
        await ent.it?.return?.(undefined);
        ent.it = ent.sink.canvases(ct); ent.next = undefined;
        const r = await ent.it.next(); if (r.done) return; ent.next = r.value;
      }
      // advance until the frame that covers ct
      while (ent.next) {
        const w = ent.next;
        if (w.timestamp + (w.duration || 0) > ct + 1e-4) { ent.frame = w.canvas as Frame; ent.at = ct; return; }
        const r = await ent.it!.next(); if (r.done) { ent.frame = w.canvas as Frame; ent.at = ct; ent.next = undefined; return; }
        ent.next = r.value;
      }
      const w = await ent.sink.getCanvas(ct); if (w) { ent.frame = w.canvas as Frame; ent.at = ct; }   // fallback
    } catch { /* keep the last good frame */ }
  }
  private close(id: string) {
    const ent = this.e.get(id); if (!ent) return;
    ent.it?.return?.(undefined).catch?.(() => {}); ent.it = undefined; ent.next = undefined; ent.frame = undefined;
    this.e.delete(id); this.loading.delete(id);
  }
  async durationOf(id: string) { return (await this.open(id))?.dur ?? 0; }
}
