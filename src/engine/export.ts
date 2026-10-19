// In-browser video export with WebCodecs (via mediabunny). No server, no upload.
// MP4 (H.264 + AAC) where the browser supports it (Chrome, Edge, Safari); otherwise WebM (VP9 + Opus).
import { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource, QUALITY_HIGH, QUALITY_VERY_HIGH, canEncodeVideo, canEncodeAudio } from 'mediabunny';
import { Renderer } from './renderer';
import { ClipBank } from './clips';
import type { Project } from './types';

export interface ExportOpts { width: number; height: number; quality: 'high' | 'very-high'; onProgress?: (p: number, frame: number, total: number) => void; signal?: AbortSignal }
export interface ExportResult { blob: Blob; ext: 'mp4' | 'webm' }

export async function pickContainer(w: number, h: number): Promise<'mp4' | 'webm'> {
  const [avc, aac] = await Promise.all([canEncodeVideo('avc', { width: w, height: h }), canEncodeAudio('aac')]);
  return avc && aac ? 'mp4' : 'webm';
}

export async function exportVideo(project: Project, images: Record<string, any>, audio: AudioBuffer, o: ExportOpts, clips?: Record<string, Blob>): Promise<ExportResult> {
  const ext = await pickContainer(o.width, o.height);
  const canvas = document.createElement('canvas'); canvas.width = o.width; canvas.height = o.height;
  const r = new Renderer(canvas, { ...project, width: o.width, height: o.height }, images);
  if (clips && Object.keys(clips).length) r.setClips(new ClipBank(clips));
  const output = new Output({ format: ext === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: ext === 'mp4' ? 'avc' : 'vp9', bitrate: o.quality === 'very-high' ? QUALITY_VERY_HIGH : QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: project.fps });
  const aud = new AudioBufferSource({ codec: ext === 'mp4' ? 'aac' : 'opus', bitrate: ext === 'mp4' ? 320e3 : 192e3 });
  output.addAudioTrack(aud);
  output.setMetadataTags({ title: project.meta.title, artist: project.meta.artist });
  await output.start();
  const dur = project.analysis?.dur ?? audio.duration, total = Math.round(dur * project.fps);
  for (let f = 0; f < total; f++) {
    if (o.signal?.aborted) { await output.cancel(); throw new DOMException('Export cancelled', 'AbortError'); }
    await r.prepare(f / project.fps); r.renderAt(f / project.fps);
    await video.add(f / project.fps, 1 / project.fps);
    if (f % 15 === 0) { o.onProgress?.(f / total, f, total); await new Promise(res => setTimeout(res, 0)); }
  }
  await aud.add(audio);
  await output.finalize();
  o.onProgress?.(1, total, total);
  return { blob: new Blob([(output.target as BufferTarget).buffer!], { type: ext === 'mp4' ? 'video/mp4' : 'video/webm' }), ext };
}
