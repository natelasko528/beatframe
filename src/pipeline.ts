// App actions: everything between the UI and the engine/providers.
import { useStore } from './store';
import { analyze, decodeForAnalysis } from './engine/analysis';
import { parseLyrics, alignLyrics, spreadLines, linesFromTaps, linesFromLRC, finalizeLines } from './engine/align';
import { planSections, planLetters, planSigns, planEdit } from './engine/planner';
import { transcribe } from './providers/transcribe';
import { generateImage, shrink } from './providers/images';
import { polishPrompts } from './providers/llm';
import * as db from './db';
import type { Project } from './engine/types';

const S = () => useStore.getState();
const status = (s: string, busy = true) => S().set({ status: s, busy });
let uid = 0; const newId = (p: string) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

export async function loadAudio(file: File) {
  status('Decoding audio…');
  let dec;
  try { dec = await decodeForAnalysis(file); }
  catch { throw new Error(`This browser can't decode ${file.name}. Try an MP3 or WAV file, or use Chrome.`); }
  const { samples, sr, buffer } = dec;
  status('Finding the beat…');
  await new Promise(r => setTimeout(r, 20));
  const analysis = analyze(samples, sr);
  const url = URL.createObjectURL(file);
  S().set({ audioFile: file, audioBuffer: buffer, audioUrl: url });
  S().update(p => { p.analysis = analysis; p.audio = { name: file.name }; if (p.meta.title === 'Untitled') p.meta.title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 60); });
  await db.put('audio', file);
  status(`${analysis.tempo.toFixed(0)} BPM · ${analysis.beats.length} beats · ${analysis.kicks.length} kicks`, false);
  autosave();
}

function applyLines(lines: Project['lines']) {
  S().update(p => {
    p.lines = lines;
    const { sections, drops } = planSections(lines, p.analysis?.dur ?? 0); p.sections = sections; p.drops = drops;
    p.letters = planLetters(p.lines);
    if (p.letters.length >= 6 && p.plan.mode === 'per-line') p.plan.mode = 'alphabet';
    p.signs = planSigns(p.lines, S().signWords.split(',').map(s => s.trim()).filter(Boolean));
  });
}

export async function alignAuto(dropUnsung = true) {
  const st = S(), p = st.project; if (!st.audioBuffer) throw new Error('Add the song first.');
  const parsed = parseLyrics(p.lyricsRaw); if (!parsed.length) throw new Error('Paste the lyrics first.');
  const words = await transcribe(st.asr, st.audioBuffer, st.audioFile, st.keys, s => status(s));
  status('Matching your lyrics to the vocal…');
  const lines = alignLyrics(parsed, words, p.analysis!.dur, { dropUnsung });
  applyLines(lines);
  const matched = lines.reduce((a, l) => a + l.words.filter(w => w.m).length, 0), total = lines.reduce((a, l) => a + l.words.length, 0);
  status(`Timed ${lines.length} lines · ${Math.round((100 * matched) / Math.max(1, total))}% of words matched to the vocal`, false);
  autosave();
}
export function alignSpread(start: number, end: number) { applyLines(spreadLines(parseLyrics(S().project.lyricsRaw), start, end)); status('Lines spread evenly. Fine-tune them below or tap-sync.', false); }
export function alignTaps(taps: number[]) { applyLines(linesFromTaps(parseLyrics(S().project.lyricsRaw), taps, S().project.analysis!.dur)); status(`Synced ${taps.length} lines from your taps`, false); }
export function alignLrc(lrc: string) { applyLines(linesFromLRC(lrc, parseLyrics(S().project.lyricsRaw), S().project.analysis!.dur)); status('Imported LRC timing', false); }
export function nudgeLine(i: number, dt: number) { S().update(p => { const l = p.lines[i]; l.words.forEach(w => { w.s = +(w.s + dt).toFixed(3); w.e = +(w.e + dt).toFixed(3); }); finalizeLines(p.lines); }); }
export function refreshDerived() { applyLines(structuredClone(S().project.lines)); }

export function planVideo() {
  const st = S(); if (!st.project.lines.length) throw new Error('Time the lyrics first.');
  const old = st.project.scenes;
  S().update(p => {
    const { shots, scenes } = planEdit(p, st.mood, st.city);
    // keep prompts the user edited for scenes that still exist
    scenes.forEach(sc => { const o = old.find(x => x.id === sc.id); if (o && o.prompt !== sc.prompt && o.status === 'done') { sc.prompt = o.prompt; sc.status = 'done'; } else if (o?.status === 'done') sc.status = 'done'; });
    p.shots = shots; p.scenes = scenes;
  });
  status(`${S().project.shots.length} shots across ${S().project.scenes.length} scenes, cut to the beat`, false);
  autosave();
}

export async function addAsset(file: Blob, kind: 'image' | 'avatar' | 'location' | 'cover', id?: string, name = 'image') {
  const aid = id ?? newId(kind[0]);
  const bmp = await createImageBitmap(file);
  S().set({ images: { ...S().images, [aid]: bmp }, blobs: { ...S().blobs, [aid]: file } });
  S().update(p => { p.assets = p.assets.filter(a => a.id !== aid); p.assets.push({ id: aid, name, kind, url: '' }); if (kind === 'avatar' && !p.avatar.refIds.includes(aid)) p.avatar.refIds.push(aid); if (kind === 'cover') p.plan.coverId = aid; });
  await db.put('asset:' + aid, file); autosave();
  return aid;
}
export function removeAsset(id: string) {
  const { [id]: _, ...images } = S().images; const { [id]: __, ...blobs } = S().blobs;
  S().set({ images, blobs }); S().update(p => { p.assets = p.assets.filter(a => a.id !== id); p.avatar.refIds = p.avatar.refIds.filter(r => r !== id); p.scenes.forEach(s => (s.refIds = s.refIds.filter(r => r !== id))); });
  db.del('asset:' + id); autosave();
}

export async function generateScene(id: string) {
  const st = S(), sc = st.project.scenes.find(s => s.id === id); if (!sc) return;
  S().update(p => { const s = p.scenes.find(s => s.id === id)!; s.status = 'generating'; s.error = undefined; });
  try {
    const refs = await Promise.all(sc.refIds.filter(r => st.blobs[r]).map(r => shrink(st.blobs[r])));
    const vertical = st.project.height > st.project.width;
    const blob = await generateImage(st.keys, st.imageModel, sc.prompt, sc.withAvatar ? refs : refs.slice(st.project.avatar.refIds.length), vertical ? '9:16' : '16:9');
    await addAsset(blob, 'image', id, `scene ${id}`);
    S().update(p => { p.scenes.find(s => s.id === id)!.status = 'done'; });
  } catch (e: any) {
    S().update(p => { const s = p.scenes.find(s => s.id === id)!; s.status = 'error'; s.error = String(e.message || e); });
  }
}
export async function generateAll(concurrency = 3) {
  const todo = S().project.scenes.filter(s => s.status !== 'done').map(s => s.id);
  let done = 0; status(`Generating ${todo.length} scenes…`);
  const worker = async () => { while (todo.length) { const id = todo.shift()!; await generateScene(id); done++; status(`Generated ${done} scenes…`); } };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const errs = S().project.scenes.filter(s => s.status === 'error').length;
  status(errs ? `${errs} scenes failed. Check the errors on each card and retry.` : 'All scenes ready', false); autosave();
}
export async function polish() {
  const st = S(); if (!st.llm) return;
  status('Writing richer scene directions…');
  const out = await polishPrompts(st.keys, st.llm, { title: st.project.meta.title, artist: st.project.meta.artist, mood: st.mood, avatar: st.project.avatar.description, city: st.city }, st.project.scenes);
  S().update(p => p.scenes.forEach(s => { if (out[s.id]) s.prompt = out[s.id]; }));
  status('Scene prompts updated', false); autosave();
}

// ---------- persistence ----------
let saveT: any;
export function autosave() { clearTimeout(saveT); saveT = setTimeout(() => db.put('project', S().project), 600); }
export async function restore() {
  const p = await db.get<Project>('project'); if (!p) return false;
  S().set({ project: p });
  const audio = await db.get<File>('audio');
  if (audio) { const { buffer } = await decodeForAnalysis(audio); S().set({ audioFile: audio, audioBuffer: buffer, audioUrl: URL.createObjectURL(audio) }); }
  const images: Record<string, ImageBitmap> = {}, blobs: Record<string, Blob> = {};
  for (const a of p.assets) { const b = await db.get<Blob>('asset:' + a.id); if (b) { blobs[a.id] = b; images[a.id] = await createImageBitmap(b); } }
  S().set({ images, blobs }); return true;
}
const toDataUrl = (b: Blob) => new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(b); });
/** One portable file: project JSON with embedded images (audio kept separate for size). Used by the CLI too. */
export async function exportProjectFile(): Promise<Blob> {
  const st = S(), p = structuredClone(st.project);
  for (const a of p.assets) if (st.blobs[a.id]) a.url = await toDataUrl(st.blobs[a.id]);
  return new Blob([JSON.stringify(p)], { type: 'application/json' });
}
export async function importProjectFile(f: File) {
  const p: Project = JSON.parse(await f.text()); const images: Record<string, ImageBitmap> = {}, blobs: Record<string, Blob> = {};
  for (const a of p.assets) if (a.url.startsWith('data:')) { const b = await (await fetch(a.url)).blob(); blobs[a.id] = b; images[a.id] = await createImageBitmap(b); await db.put('asset:' + a.id, b); a.url = ''; }
  S().set({ project: p, images, blobs }); autosave();
}
export async function resetProject() { const { newProject } = await import('./store'); S().set({ project: newProject(), images: {}, blobs: {}, audioFile: null, audioBuffer: null, audioUrl: null, step: 'song' }); await db.del('project'); await db.del('audio'); }
