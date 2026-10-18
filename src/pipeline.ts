// App actions: everything between the UI and the engine/providers.
// autoCreate() runs the whole production from one upload: code does the grunt work, AI only supplies ideas.
import { useStore, newProject, RUN_STEPS } from './store';
import { analyze, decodeForAnalysis } from './engine/analysis';
import { parseLyrics, alignLyrics, spreadLines, linesFromTaps, linesFromLRC, finalizeLines, linesFromTranscript } from './engine/align';
import { planSections, planLetters, planSigns, planEdit } from './engine/planner';
import { autoBrief, briefRequest, mergeBrief, applyBrief, capScenes, type Brief } from './engine/director';
import { promptForScene } from './engine/prompts';
import { transcribe } from './providers/transcribe';
import { generateImage, shrink, autoImageModel } from './providers/images';
import { creativeBrief, autoModels } from './providers/llm';
import * as db from './db';
import type { Project } from './engine/types';

const S = () => useStore.getState();
const status = (s: string, busy = true) => S().set({ status: s, busy });
let uid = 0; const newId = (p: string) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

// ---------- the one-click production ----------
export interface CreateInput { file: File; lyrics?: string; photos?: File[]; title?: string; artist?: string; look?: string; vertical?: boolean }

export async function autoCreate(input: CreateInput) {
  const st = S();
  const models = autoModels(st.keys.keys); const im = autoImageModel(st.keys.keys);
  st.set({ screen: 'producing', run: structuredClone(RUN_STEPS), runError: '', llm: models.llm, ...(im ? { imageModel: im } : {}),
    asr: st.keys.keys.openai ? { kind: 'openai', model: 'whisper-1' } : { kind: 'local', model: 'onnx-community/whisper-base.en' } });
  const step = S().step;
  try {
    // fresh project
    const p0 = newProject();
    p0.lyricsRaw = input.lyrics?.trim() ?? '';
    p0.meta.title = input.title?.trim() || input.file.name.replace(/\.[^.]+$/, '').replace(/^.*? - /, '').replace(/[_]+/g, ' ').replace(/\s*\d{4}-\d{2}-\d{2}.*$/, '').slice(0, 60);
    p0.meta.artist = input.artist?.trim() ?? '';
    if (input.vertical) { p0.width = 1080; p0.height = 1920; }
    S().set({ project: p0, images: {}, blobs: {} });
    for (const ph of input.photos ?? []) await addAsset(ph, 'avatar', undefined, ph.name);

    // 1. beat (code)
    step('beat', 'run');
    await loadAudio(input.file);
    const A = S().project.analysis!;
    step('beat', 'done', `${Math.round(A.tempo)} BPM · ${A.beats.length} beats${A.features ? ` · ${A.features.key} ${A.features.mode}` : ''}`);

    // 2. words (ASR via user key or free on-device model; alignment is code)
    step('words', 'run', S().asr.kind === 'openai' ? 'Transcribing with OpenAI Whisper…' : 'Transcribing on your device (first run downloads a model)…');
    const parsed = parseLyrics(p0.lyricsRaw);
    let lines: Project['lines'];
    try {
      const words = await transcribe(S().asr, S().audioBuffer!, S().audioFile, S().keys, s => step('words', 'run', s));
      lines = parsed.length ? alignLyrics(parsed, words, A.dur, { dropUnsung: true }) : linesFromTranscript(words, A.dur);
    } catch (e: any) {
      if (!parsed.length) throw new Error(`Couldn't transcribe the vocal (${e.message}). Paste the lyrics and try again.`);
      lines = spreadLines(parsed, A.beats[4] ?? 0, A.dur - 4);
    }
    applyLines(lines);
    const m = lines.reduce((a, l) => a + l.words.filter(w => w.m).length, 0), tot = lines.reduce((a, l) => a + l.words.length, 0);
    step('words', 'done', `${lines.length} lines${parsed.length ? ` · ${Math.round((100 * m) / Math.max(1, tot))}% of words matched` : ' from the vocal'}`);

    // 3. brief (code suggestion, then one optional AI call for ideas)
    step('brief', 'run', 'Reading the song…');
    let brief = autoBrief(S().project);
    if (input.look) brief.preset = input.look;
    S().update(p => { p.brief = brief; p.mood = brief.mood; p.plan.mode = brief.cutting; });
    // 4. edit plan (code) — needed before the AI brief so the AI can write one idea per scene slot
    step('edit', 'run');
    planVideo();
    S().update(p => capScenes(p, p.plan.sceneBudget ?? 24));
    if (S().llm) {
      step('brief', 'run', 'Creative director is writing ideas…');
      try {
        const ai = await creativeBrief(S().keys, S().llm!, briefRequest(S().project, brief));
        brief = mergeBrief(brief, ai);
        if (input.look) brief.preset = input.look;
      } catch (e: any) { step('brief', 'run', `AI ideas unavailable (${e.message.slice(0, 80)}); using the song-based brief`); }
    }
    commitBrief(brief);
    step('brief', 'done', brief.concept);
    const P = S().project;
    step('edit', 'done', `${P.shots.length} shots · ${P.scenes.length} scenes${P.letters.length ? ' · alphabet mode' : ''}`);

    // 5. scenes (AI images with the user's key; skipped without one)
    if (im) {
      step('scenes', 'run', `0 of ${P.scenes.length}`);
      await generateAll(3, (d, n) => step('scenes', 'run', `${d} of ${n}`));
      const errs = S().project.scenes.filter(s => s.status === 'error');
      step('scenes', errs.length ? 'error' : 'done', errs.length ? `${errs.length} failed: ${errs[0].error?.slice(0, 120)}` : `${P.scenes.length} ready`);
    } else step('scenes', 'skip', 'Add an image key, or upload your own images in Scenes');
    step('ready', 'done');
    S().set({ screen: 'studio', tab: 'vibe', status: '', busy: false });
    autosave();
  } catch (e: any) {
    S().set({ runError: String(e?.message || e), busy: false });
    const cur = S().run.find(s => s.status === 'run'); if (cur) step(cur.id, 'error', String(e?.message || e));
  }
}

/** Set a brief as the suggestion and apply it (look, mood, scene ideas, signs). */
export function commitBrief(brief: Brief) {
  S().update(p => {
    p.brief = brief; p.mood = brief.mood;
    applyBrief(p, brief);
    p.signs = planSigns(p.lines, brief.signWords);
    p.scenes.forEach(s => { if (brief.sceneIdeas[s.id]) s.idea = brief.sceneIdeas[s.id]; s.prompt = promptForScene(p, s); });
  });
}
/** Change one setting and re-derive dependent prompts (used by the studio's editable suggestions). */
export function setMood(mood: string) { S().update(p => { p.mood = mood; p.scenes.forEach(s => (s.prompt = promptForScene(p, s))); }); autosave(); }
export function setCity(city: string) { S().update(p => { if (p.brief) p.brief.city = city; p.scenes.forEach(s => (s.prompt = promptForScene(p, s))); }); autosave(); }
export function setSignWords(words: string[]) { S().update(p => { if (p.brief) p.brief.signWords = words; p.signs = planSigns(p.lines, words); }); autosave(); }
export function setSceneIdea(id: string, idea: string) { S().update(p => { const s = p.scenes.find(x => x.id === id)!; s.idea = idea; s.custom = false; s.prompt = promptForScene(p, s); }); autosave(); }
export function setScenePrompt(id: string, prompt: string) { S().update(p => { const s = p.scenes.find(x => x.id === id)!; s.prompt = prompt; s.custom = true; }); autosave(); }

// ---------- building blocks ----------
export async function loadAudio(file: File) {
  status('Decoding audio…');
  let dec;
  try { dec = await decodeForAnalysis(file); }
  catch { throw new Error(`This browser can't decode ${file.name}. Try an MP3 or WAV file, or use Chrome.`); }
  const { samples, sr, buffer } = dec;
  status('Finding the beat…');
  await new Promise(r => setTimeout(r, 20));
  const analysis = analyze(samples, sr);
  S().set({ audioFile: file, audioBuffer: buffer, audioUrl: URL.createObjectURL(file) });
  S().update(p => { p.analysis = analysis; p.audio = { name: file.name }; });
  await db.put('audio', file);
  status('', false);
}

function applyLines(lines: Project['lines']) {
  S().update(p => {
    p.lines = lines;
    const { sections, drops } = planSections(lines, p.analysis?.dur ?? 0); p.sections = sections; p.drops = drops;
    p.letters = planLetters(p.lines);
    p.signs = planSigns(p.lines, p.brief?.signWords ?? []);
  });
}
export async function retimeLyrics() {
  const st = S(), p = st.project; if (!st.audioBuffer) throw new Error('Add the song first.');
  const parsed = parseLyrics(p.lyricsRaw);
  status('Timing lyrics…');
  const words = await transcribe(st.asr, st.audioBuffer, st.audioFile, st.keys, s => status(s));
  applyLines(parsed.length ? alignLyrics(parsed, words, p.analysis!.dur, { dropUnsung: true }) : linesFromTranscript(words, p.analysis!.dur));
  status('Lyrics re-timed', false); autosave();
}
export function alignSpread(start: number, end: number) { applyLines(spreadLines(parseLyrics(S().project.lyricsRaw), start, end)); }
export function alignTaps(taps: number[]) { applyLines(linesFromTaps(parseLyrics(S().project.lyricsRaw), taps, S().project.analysis!.dur)); }
export function alignLrc(lrc: string) { applyLines(linesFromLRC(lrc, parseLyrics(S().project.lyricsRaw), S().project.analysis!.dur)); }
export function nudgeLine(i: number, dt: number) { S().update(p => { const l = p.lines[i]; l.words.forEach(w => { w.s = +(w.s + dt).toFixed(3); w.e = +(w.e + dt).toFixed(3); }); finalizeLines(p.lines); }); autosave(); }
export function editLineText(i: number, text: string) {
  S().update(p => { const l = p.lines[i]; const toks = text.split(/\s+/).filter(Boolean); const s = l.start, e = l.end, st = (e - s) / Math.max(1, toks.length);
    l.text = text; l.words = toks.map((d, k) => ({ d, s: +(s + k * st).toFixed(3), e: +(s + (k + 1) * st - 0.02).toFixed(3), m: false })); finalizeLines(p.lines); });
  autosave();
}
export function refreshDerived() { applyLines(structuredClone(S().project.lines)); }

export function planVideo() {
  const st = S(); if (!st.project.lines.length) throw new Error('Time the lyrics first.');
  const old = st.project.scenes;
  S().update(p => {
    const { shots, scenes } = planEdit(p, p.mood ?? 'After-dark luxury', p.brief?.city ?? '');
    scenes.forEach(sc => {   // keep the user's own words and finished images for scenes that still exist
      const o = old.find(x => x.id === sc.id); if (!o) return;
      if (o.idea) sc.idea = o.idea; if (o.custom) { sc.custom = true; sc.prompt = o.prompt; }
      if (o.status === 'done') sc.status = 'done';
    });
    scenes.forEach(sc => { if (!sc.custom) sc.prompt = promptForScene(p, sc); });
    p.shots = shots; p.scenes = scenes;
  });
  autosave();
}
export function replan() { planVideo(); S().update(p => capScenes(p, p.plan.sceneBudget ?? 24)); autosave(); }

export async function addAsset(file: Blob, kind: 'image' | 'avatar' | 'location' | 'cover', id?: string, name = 'image') {
  const aid = id ?? newId(kind[0]);
  const bmp = await createImageBitmap(file);
  S().set({ images: { ...S().images, [aid]: bmp }, blobs: { ...S().blobs, [aid]: file } });
  S().update(p => {
    p.assets = p.assets.filter(a => a.id !== aid); p.assets.push({ id: aid, name, kind, url: '' });
    if (kind === 'avatar' && !p.avatar.refIds.includes(aid)) { p.avatar.refIds.push(aid); p.scenes.forEach(s => s.withAvatar && !s.refIds.includes(aid) && s.refIds.push(aid)); }
    if (kind === 'cover') p.plan.coverId = aid;
  });
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
    const avatarIds = new Set(st.project.avatar.refIds);
    const refIds = sc.refIds.filter(r => st.blobs[r] && (sc.withAvatar || !avatarIds.has(r)));
    const refs = await Promise.all(refIds.map(r => shrink(st.blobs[r])));
    const vertical = st.project.height > st.project.width;
    const blob = await generateImage(st.keys, st.imageModel, sc.prompt, refs, vertical ? '9:16' : '16:9');
    await addAsset(blob, 'image', id, `scene ${id}`);
    S().update(p => { p.scenes.find(s => s.id === id)!.status = 'done'; });
  } catch (e: any) {
    S().update(p => { const s = p.scenes.find(s => s.id === id); if (s) { s.status = 'error'; s.error = String(e.message || e); } });
  }
}
export async function generateAll(concurrency = 3, onProgress?: (done: number, total: number) => void) {
  const todo = S().project.scenes.filter(s => s.status !== 'done').map(s => s.id); const total = todo.length;
  let done = 0; onProgress?.(0, total);
  const worker = async () => { while (todo.length) { const id = todo.shift()!; await generateScene(id); done++; onProgress?.(done, total); } };
  await Promise.all(Array.from({ length: concurrency }, worker));
  autosave();
}

// ---------- persistence ----------
let saveT: any;
export function autosave() { clearTimeout(saveT); saveT = setTimeout(() => db.put('project', S().project), 600); }
export async function restore() {
  const p = await db.get<Project>('project'); if (!p || !p.shots?.length) return false;
  S().set({ project: { ...newProject(), ...p } });
  const audio = await db.get<File>('audio');
  if (audio) { const { buffer } = await decodeForAnalysis(audio); S().set({ audioFile: audio, audioBuffer: buffer, audioUrl: URL.createObjectURL(audio) }); }
  const images: Record<string, ImageBitmap> = {}, blobs: Record<string, Blob> = {};
  for (const a of p.assets) { const b = await db.get<Blob>('asset:' + a.id); if (b) { blobs[a.id] = b; images[a.id] = await createImageBitmap(b); } }
  S().set({ images, blobs, screen: 'studio' }); return true;
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
  S().set({ project: { ...newProject(), ...p }, images, blobs, screen: 'studio' }); autosave();
}
export async function resetProject() {
  S().set({ project: newProject(), images: {}, blobs: {}, audioFile: null, audioBuffer: null, audioUrl: null, screen: 'start', run: structuredClone(RUN_STEPS), runError: '' });
  await db.del('project'); await db.del('audio');
}
