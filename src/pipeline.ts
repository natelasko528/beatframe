// App actions. autoCreate() runs the whole production from one upload.
// Code does all the measuring and assembling; every creative decision comes from the user's chosen AI
// through the stages in engine/stages.ts (with free code fallbacks when no AI key is set).
import { useStore, newProject, RUN_STEPS } from './store';
import { analyze, decodeForAnalysis } from './engine/analysis';
import { parseLyrics, alignLyrics, spreadLines, linesFromTaps, linesFromLRC, finalizeLines, linesFromTranscript, type AsrWord } from './engine/align';
import { planSections, planLetters, planSigns, planEdit, capScenes } from './engine/planner';
import * as St from './engine/stages';
import { Renderer } from './engine/renderer';
import { transcribe } from './providers/transcribe';
import { generateImage, shrink, pricePerImage, type ImageModel } from './providers/images';
import { askJSON, geminiLyrics, defaultAi, usage, type AiModel } from './providers/ai';
import * as db from './db';
import type { Project, Scene } from './engine/types';

const S = () => useStore.getState();
const status = (s: string, busy = true) => S().set({ status: s, busy });
let uid = 0; const newId = (p: string) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;
const spendAi = () => S().set({ spend: { ...S().spend, ai: usage.usd } });

/** Which image model to use: the chosen AI's own image model when it has one, else any image key. */
export function pickImageModel(ai: AiModel | null, keys: Record<string, string | undefined>): ImageModel | null {
  if (ai?.provider === 'openai' && keys.openai) return { provider: 'openai', model: 'gpt-image-1', quality: 'medium' };
  if (ai?.provider === 'gemini' && keys.gemini) return { provider: 'gemini', model: 'gemini-2.5-flash-image', quality: 'medium' };
  if (keys.gemini) return { provider: 'gemini', model: 'gemini-2.5-flash-image', quality: 'medium' };
  if (keys.openai) return { provider: 'openai', model: 'gpt-image-1', quality: 'medium' };
  if (keys.fal) return { provider: 'fal', model: 'fal-ai/flux-pro/kontext', quality: 'medium' };
  return null;
}
/** Estimated total for a run, shown before anything is spent. */
export function estimate(budget: number, ai: AiModel | null, im: ImageModel | null, checks: boolean) {
  const images = im ? budget * pricePerImage(im) * (checks ? 1.15 : 1) : 0;    // ~15% re-rolls after the image check
  const aiCost = ai ? (/(opus)/.test(ai.model) ? 0.9 : /(sonnet|gpt-5$|pro)/.test(ai.model) ? 0.25 : 0.04) * (checks ? 1 : 0.6) : 0;
  return { images, ai: aiCost, total: images + aiCost };
}

// ---------- the one-click production ----------
export interface CreateInput { file: File; lyrics?: string; photos?: File[]; title?: string; artist?: string; notes?: string; vertical?: boolean }

export async function autoCreate(input: CreateInput) {
  const st = S();
  const ai = st.ai ?? defaultAi(st.keys.keys);
  const im = st.imageModel ?? pickImageModel(ai, st.keys.keys);
  usage.inTok = usage.outTok = usage.usd = 0;
  st.set({ screen: 'producing', run: structuredClone(RUN_STEPS), runError: '', ai, imageModel: im, spend: { ai: 0, images: 0 },
    asr: ai?.provider === 'openai' && st.keys.keys.openai ? { kind: 'openai', model: 'whisper-1' } : { kind: 'local', model: 'onnx-community/whisper-base_timestamped' } });
  const step = S().step, keys = S().keys;
  try {
    const p0 = newProject();
    p0.lyricsRaw = input.lyrics?.trim() ?? '';
    p0.meta.title = input.title?.trim() || cleanTitle(input.file.name);
    p0.meta.artist = input.artist?.trim() ?? '';
    p0.notes = input.notes?.trim() ?? '';
    p0.plan.sceneBudget = S().opts.budget;
    if (input.vertical) { p0.width = 1080; p0.height = 1920; }
    S().set({ project: p0, images: {}, blobs: {} });
    for (const ph of input.photos ?? []) await addAsset(ph, 'avatar', undefined, ph.name);
    const hasPhotos = (input.photos?.length ?? 0) > 0;

    // 1. beat, tempo, key — code
    step('beat', 'run');
    await loadAudio(input.file);
    const A = S().project.analysis!;
    step('beat', 'done', `${Math.round(A.tempo)} BPM · ${A.features ? `${A.features.key} ${A.features.mode} · ` : ''}${A.beats.length} beats`);

    // 2. words — the chosen AI listens (OpenAI Whisper / Gemini), otherwise the free on-device model; timing is code
    const parsed = parseLyrics(p0.lyricsRaw);
    step('words', 'run', ai?.provider === 'gemini' ? 'Gemini is listening to the vocal…' : S().asr.kind === 'openai' ? 'Whisper is listening to the vocal…' : 'Listening on your device (first run downloads a small model)…');
    let lines: Project['lines']; let heard = true;
    try {
      let words: AsrWord[];
      if (ai?.provider === 'gemini') words = geminiLinesToWords(await geminiLyrics(keys, ai.model, input.file, p0.lyricsRaw.slice(0, 4000)));
      else words = await transcribe(S().asr, S().audioBuffer!, S().audioFile, keys, s => step('words', 'run', s));
      lines = parsed.length ? alignLyrics(parsed, words, A.dur, { dropUnsung: true }) : linesFromTranscript(words, A.dur);
      if (!lines.length) throw new Error('no vocal found');
    } catch (e: any) {
      if (!parsed.length) throw new Error(`Couldn't hear the vocal (${e.message}). Paste the lyrics and try again.`);
      lines = spreadLines(parsed, A.beats[4] ?? 0, A.dur - 4); heard = false;
      S().set({ status: `Couldn't hear the vocal (${String(e?.message || e).slice(0, 80)}), so the lyrics are spread evenly. Fix the timing in Lyrics.` });
    }
    applyLines(lines);
    const m = lines.reduce((a, l) => a + l.words.filter(w => w.m).length, 0), tot = lines.reduce((a, l) => a + l.words.length, 0);
    step('words', heard ? 'done' : 'skip', heard ? `${lines.length} lines${parsed.length ? ` · ${Math.round((100 * m) / Math.max(1, tot))}% matched to the vocal` : ''}` : `Couldn't hear the vocal here, so ${lines.length} lines are spread evenly. Re-time them in Lyrics.`);

    // 3. reading — AI (fallback: code)
    step('reading', 'run', ai ? `${aiLabel(ai)} is reading the lyrics…` : 'Reading the lyrics…');
    let reading = St.autoReading(S().project);
    if (ai) { try { const q = St.readingPrompt(S().project, p0.notes); reading = St.validReading(await askJSON(keys, ai, q.system, q.user, [], 3000)); } catch (e: any) { step('reading', 'run', aiFail(e)); } }
    S().update(p => { p.reading = reading; });
    spendAi();
    step('reading', 'done', [reading.genre !== 'unknown' ? reading.genre + (reading.subgenre ? ` · ${reading.subgenre}` : '') : '', reading.themes.slice(0, 3).join(', ')].filter(Boolean).join(' — '));

    // 4. direction — AI (fallback: code from measured features)
    step('direction', 'run', ai ? 'Designing the look…' : 'Choosing a look from the song…');
    const autoDir = St.autoDirection(S().project, reading);
    let dir = autoDir;
    if (ai) { try { const q = St.directionPrompt(S().project, reading, p0.notes); dir = St.validDirection(await askJSON(keys, ai, q.system, q.user, [], 3500), autoDir); } catch (e: any) { step('direction', 'run', aiFail(e)); } }
    applyDirection(dir, true);
    spendAi();
    step('direction', 'done', dir.concept);

    // 5. shot list — code cuts on the beat; AI writes every scene
    step('edit', 'run', 'Cutting on the beat…');
    planVideo();
    S().update(p => capScenes(p, p.plan.sceneBudget ?? 16));
    if (ai) {
      step('edit', 'run', 'Writing the scenes…');
      try {
        const q = St.scenesPrompt(S().project, reading, dir, hasPhotos, p0.notes);
        const ideas = St.validScenes(await askJSON(keys, ai, q.system, q.user, [], 6000), S().project.scenes.map(s => s.id), hasPhotos);
        applySceneIdeas(ideas);
      } catch (e: any) { step('edit', 'run', aiFail(e)); }
    } else S().update(p => p.scenes.forEach(s => {
      if (!hasPhotos) s.withAvatar = false;
      // code fallback: the lyric itself is the brief until the user (or an AI) writes a better one
      if (!s.idea && s.lyric) s.idea = `${s.word ? `"${s.word}": ` : ''}a scene that shows "${s.lyric}"`;
    }));
    refreshPrompts();
    spendAi();
    const P = S().project;
    step('edit', 'done', `${P.shots.length} shots · ${P.scenes.length} scenes${P.letters.length ? ' · alphabet song' : ''}`);

    // 6. scenes — AI images (+ AI image check with one automatic re-roll)
    if (im) {
      step('scenes', 'run', `0 of ${P.scenes.length}`);
      await generateAll(3, (d, n) => step('scenes', 'run', `${d} of ${n}`));
      const errs = S().project.scenes.filter(s => s.status === 'error');
      step('scenes', errs.length === P.scenes.length ? 'error' : 'done', errs.length ? `${P.scenes.length - errs.length} ready · ${errs.length} failed: ${errs[0].error?.slice(0, 100)}` : `${P.scenes.length} ready`);
    } else step('scenes', 'skip', 'No image key: upload your own images in Scenes, or add an OpenAI, Gemini or fal key');

    // 7. frame check — AI looks at rendered frames and fixes layout (code applies)
    if (ai && S().opts.frameCheck && Object.keys(S().images).length) {
      step('check', 'run', 'Reviewing rendered frames…');
      try { await frameCheck(); step('check', 'done', S().project.frameNotes?.[0] ?? 'Looks good'); }
      catch (e: any) { step('check', 'skip', aiFail(e)); }
    } else step('check', 'skip');
    spendAi();
    step('ready', 'done');
    S().set({ screen: 'studio', tab: 'vibe', status: heard ? '' : S().status, busy: false });
    autosave();
  } catch (e: any) {
    S().set({ runError: String(e?.message || e), busy: false });
    const cur = S().run.find(s => s.status === 'run'); if (cur) step(cur.id, 'error', String(e?.message || e));
  }
}
const aiLabel = (ai: AiModel) => ({ anthropic: 'Claude', openai: 'ChatGPT', gemini: 'Gemini', openrouter: ai.model.split('/')[0] } as any)[ai.provider] ?? 'AI';
const aiFail = (e: any) => `AI step failed (${String(e?.message || e).slice(0, 90)}); using the code version`;
function cleanTitle(name: string) {
  let t = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s*\d{4}-\d{2}-\d{2}.*$/, '');
  if (t.includes(' - ')) t = t.split(' - ').slice(1).join(' - ');
  return t.trim().slice(0, 60) || 'Untitled';
}
function geminiLinesToWords(lines: { t: number; e: number; text: string }[]): AsrWord[] {
  const syl = (w: string) => Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) || []).length);
  return lines.flatMap(l => {
    const ws = l.text.split(/\s+/).filter(Boolean), weights = ws.map(syl), tot = weights.reduce((a, b) => a + b, 0) || 1; let t = l.t; const span = Math.max(0.3, l.e - l.t);
    return ws.map((w, i) => { const d = (span * weights[i]) / tot; const o = { w, s: t, e: t + d * 0.9 }; t += d; return o; });
  });
}

// ---------- applying AI output ----------
export function applyDirection(d: St.Direction, asSuggestion = false) {
  S().update(p => {
    const hasLetters = p.letters.filter(l => l.kind === 'verse').length >= 6;
    p.direction = d; if (asSuggestion) p.suggested = structuredClone(d);
    p.style = St.directionToStyle(d, hasLetters);
    p.style.lyrics.hotWords = p.reading?.hotWords ?? [];
    p.plan.mode = hasLetters ? 'alphabet' : (p.analysis && p.analysis.tempo > 140 && d.energy > 0.75 ? 'beats' : 'per-line');
    p.meta.tagline = d.titleCard.tagline; p.meta.definition = d.titleCard.definition;
    p.signs = planSigns(p.lines, d.graphics.placeSigns ? (p.reading?.places ?? []) : []);
    p.mood = d.mood;
  });
  refreshPrompts(); autosave();
}
/** Edit one field of the direction (from the studio). Re-derives style and prompts in code — no AI call. */
export function editDirection(fn: (d: St.Direction) => void) { const d = structuredClone(S().project.direction!); fn(d); applyDirection(d); }
export function resetDirectionField<K extends keyof St.Direction>(k: K) { const s = S().project.suggested; if (s) editDirection(d => { (d as any)[k] = structuredClone(s[k]); }); }
function applySceneIdeas(ideas: St.SceneIdea[]) {
  S().update(p => {
    const places = new Set((p.reading?.places ?? []).map(x => x.toLowerCase()));
    for (const i of ideas) {
      const s = p.scenes.find(x => x.id === i.id); if (!s) continue;
      s.idea = i.idea; s.withAvatar = i.artist; s.location = i.location; s.shot = i.shot;
      if (!s.withAvatar) s.refIds = s.refIds.filter(r => !p.avatar.refIds.includes(r));
      if (p.style.features.captions && i.location && places.has(i.location.toLowerCase())) p.shots.filter(x => x.img === s.id).slice(0, 1).forEach(x => (x.caption = i.location.toUpperCase()));
    }
  });
}
export function refreshPrompts() {
  S().update(p => { const prov = S().imageModel?.provider ?? 'openai'; p.scenes.forEach(s => (s.prompt = St.imagePrompt(p, s, p.direction, prov))); });
}
export function setSceneIdea(id: string, idea: string) { S().update(p => { const s = p.scenes.find(x => x.id === id)!; s.idea = idea; s.custom = false; }); refreshPrompts(); autosave(); }
export function setScenePrompt(id: string, prompt: string) { S().update(p => { const s = p.scenes.find(x => x.id === id)!; s.prompt = prompt; s.custom = true; }); autosave(); }
export function setSceneArtist(id: string, on: boolean) {
  S().update(p => { const s = p.scenes.find(x => x.id === id)!; s.withAvatar = on; s.refIds = on ? [...new Set([...s.refIds, ...p.avatar.refIds])] : s.refIds.filter(r => !p.avatar.refIds.includes(r)); });
  refreshPrompts(); autosave();
}
/** Ask the AI for a fresh idea for one scene (a fraction of a cent). */
export async function rewriteScene(id: string, wish = '') {
  const st = S(), p = st.project; if (!st.ai) throw new Error('Add an AI key to get new ideas.');
  const s = p.scenes.find(x => x.id === id)!;
  const r = await askJSON<{ idea: string; artist: boolean; location: string; shot: string }>(st.keys, st.ai,
    'You are the music-video director revising one scene of the shot list. Keep the video\'s world, wardrobe and continuity. Under 40 words: setting, action, camera angle, light. No readable text in the image. Reply with JSON only.',
    `Concept: ${p.direction?.concept}. World: ${p.direction?.world}. Locations: ${p.direction?.locations.join(', ')}.
Lyric under this scene: "${s.lyric}"${s.word ? ` (must embody the word "${s.word}")` : ''}. Current idea: ${s.idea}.
Other scenes (don't repeat them): ${p.scenes.filter(x => x.id !== id).map(x => x.idea).filter(Boolean).slice(0, 30).join(' | ')}
${wish ? `The artist wants: ${wish}` : 'Give a clearly different, stronger idea.'}
Return JSON: {"idea": "...", "artist": ${s.withAvatar}, "location": "...", "shot": "wide|medium|close-up|detail|overhead|low angle"}`, [], 600);
  S().update(pp => { const x = pp.scenes.find(y => y.id === id)!; x.idea = String(r.idea || x.idea).slice(0, 320); x.location = r.location || x.location; x.shot = r.shot || x.shot; x.custom = false; });
  refreshPrompts(); spendAi(); autosave();
}
/** Re-run creative direction with the artist's wish (one AI call), keeping lyrics, timing and the cut. */
export async function redirect(wish: string) {
  const st = S(), p = st.project; if (!st.ai) throw new Error('Add an AI key to get new ideas.');
  status('Rethinking the look…');
  const q = St.directionPrompt(p, p.reading ?? St.autoReading(p), [p.notes, wish].filter(Boolean).join('. '));
  applyDirection(St.validDirection(await askJSON(st.keys, st.ai, q.system, q.user, [], 3500), p.direction ?? St.autoDirection(p, p.reading ?? St.autoReading(p))), true);
  spendAi(); status('', false);
}

// ---------- frame check (vision) ----------
async function frameCheck() {
  const st = S(), p = st.project;
  const pick = (pred: (l: Project['lines'][number]) => boolean) => p.lines.filter(pred).map(l => (l.start + l.end) / 2);
  const times = [...pick(l => l.style === 'hook').slice(0, 2), ...pick(l => l.style === 'verse').filter((_, i) => i % 6 === 2).slice(0, 3)].slice(0, 5);
  if (!times.length) return;
  const cv = new OffscreenCanvas(960, Math.round((960 * p.height) / p.width));
  const r = new Renderer(cv, { ...p, width: cv.width, height: cv.height }, st.images as any);
  const shots: Blob[] = [];
  for (const t of times) { r.renderAt(t); shots.push(await cv.convertToBlob({ type: 'image/jpeg', quality: 0.8 })); }
  const q = St.frameCheckPrompt(p, times);
  const n = St.validFrameNotes(await askJSON(st.keys, st.ai!, q.system, q.user, shots, 800));
  S().update(pp => {
    if (n.lyricLayout) pp.style.lyrics.layout = n.lyricLayout; if (n.lyricSize) pp.style.lyrics.size = n.lyricSize;
    if (n.letterbox !== undefined) pp.style.grade.letterbox = n.letterbox;
    if (n.placeSigns !== undefined) pp.style.features.signs = n.placeSigns; if (n.locationCaptions !== undefined) pp.style.features.captions = n.locationCaptions;
    if (pp.direction) { if (n.lyricLayout) pp.direction.lyrics.layout = n.lyricLayout; if (n.lyricSize) pp.direction.lyrics.size = n.lyricSize; if (n.letterbox !== undefined) pp.direction.grade.letterbox = n.letterbox; }
    pp.frameNotes = n.notes;
  });
}

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
    p.signs = planSigns(p.lines, p.direction?.graphics.placeSigns ? (p.reading?.places ?? []) : []);
  });
}
export async function retimeLyrics() {
  const st = S(), p = st.project; if (!st.audioBuffer) throw new Error('Add the song first.');
  const parsed = parseLyrics(p.lyricsRaw);
  status('Timing lyrics…');
  const words = st.ai?.provider === 'gemini' ? geminiLinesToWords(await geminiLyrics(st.keys, st.ai.model, st.audioFile!, p.lyricsRaw.slice(0, 4000)))
    : await transcribe(st.asr, st.audioBuffer, st.audioFile, st.keys, s => status(s));
  applyLines(parsed.length ? alignLyrics(parsed, words, p.analysis!.dur, { dropUnsung: true }) : linesFromTranscript(words, p.analysis!.dur));
  status('', false); autosave();
}
/** Time the pasted lyrics against a transcript you already have (e.g. from an external Whisper run). */
export function alignWords(words: AsrWord[]) { applyLines(alignLyrics(parseLyrics(S().project.lyricsRaw), words, S().project.analysis!.dur, { dropUnsung: true })); }
export function alignSpread(start: number, end: number) { applyLines(spreadLines(parseLyrics(S().project.lyricsRaw), start, end)); }
export function alignTaps(taps: number[]) { applyLines(linesFromTaps(parseLyrics(S().project.lyricsRaw), taps, S().project.analysis!.dur)); }
export function alignLrc(lrc: string) { applyLines(linesFromLRC(lrc, parseLyrics(S().project.lyricsRaw), S().project.analysis!.dur)); }
export function nudgeLine(i: number, dt: number) { S().update(p => { const l = p.lines[i]; l.words.forEach(w => { w.s = +(w.s + dt).toFixed(3); w.e = +(w.e + dt).toFixed(3); }); finalizeLines(p.lines); }); autosave(); }
export function editLineText(i: number, text: string) {
  S().update(p => { const l = p.lines[i]; const toks = text.split(/\s+/).filter(Boolean); const s = l.start, e = l.end, st = (e - s) / Math.max(1, toks.length);
    l.text = text; l.words = toks.map((d, k) => ({ d, s: +(s + k * st).toFixed(3), e: +(s + (k + 1) * st - 0.02).toFixed(3), m: false })); finalizeLines(p.lines); });
  autosave();
}

export function planVideo() {
  const st = S(); if (!st.project.lines.length) throw new Error('Time the lyrics first.');
  const old = st.project.scenes;
  S().update(p => {
    const { shots, scenes } = planEdit(p, p.mood ?? '', p.reading?.places?.[0] ?? '');
    scenes.forEach(sc => {    // keep the user's words and finished images for scenes that still exist
      const o = old.find(x => x.id === sc.id); if (!o) return;
      Object.assign(sc, { idea: o.idea, location: o.location, shot: o.shot, withAvatar: o.withAvatar });
      if (o.custom) { sc.custom = true; sc.prompt = o.prompt; }
      if (o.status === 'done') sc.status = 'done';
    });
    p.shots = shots; p.scenes = scenes;
  });
  autosave();
}
export function replan() { planVideo(); S().update(p => capScenes(p, p.plan.sceneBudget ?? 16)); refreshPrompts(); autosave(); }

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

/** Generate one scene; with image checking on, the AI judges it and one automatic re-roll fixes a failure. */
export async function generateScene(id: string) {
  const st = S(), sc = st.project.scenes.find(s => s.id === id); if (!sc || !st.imageModel) return;
  S().update(p => { const s = p.scenes.find(s => s.id === id)!; s.status = 'generating'; s.error = undefined; s.verdict = undefined; });
  try {
    const avatarIds = new Set(st.project.avatar.refIds);
    const refIds = [...new Set([...(sc.withAvatar ? st.project.avatar.refIds : []), ...sc.refIds])].filter(r => st.blobs[r] && (sc.withAvatar || !avatarIds.has(r)));
    const refs = await Promise.all(refIds.map(r => shrink(st.blobs[r])));
    const aspect = st.project.height > st.project.width ? '9:16' : '16:9';
    let prompt = sc.prompt, blob = await generateImage(st.keys, st.imageModel, prompt, refs, aspect);
    S().set({ spend: { ...S().spend, images: S().spend.images + pricePerImage(st.imageModel) } });
    if (st.ai && st.opts.checkImages) {
      const check = async (b: Blob) => { const q = St.imageCheckPrompt(sc, sc.withAvatar && refs.length > 0); return St.validVerdict(await askJSON(st.keys, st.ai!, q.system, q.user, [...(sc.withAvatar && refs[0] ? [refs[0]] : []), await shrink(b, 768)], 400)); };
      let v = await check(blob).catch(() => null);
      if (v && !v.pass) {
        prompt = `${sc.prompt} Avoid: ${v.issues.join('; ')}. ${v.fix}`.trim();
        const b2 = await generateImage(st.keys, st.imageModel, prompt, refs, aspect);
        S().set({ spend: { ...S().spend, images: S().spend.images + pricePerImage(st.imageModel) } });
        const v2 = await check(b2).catch(() => null);
        if (!v2 || v2.score >= v.score) { blob = b2; v = v2 ?? v; }
      }
      if (v) S().update(p => { const s = p.scenes.find(x => x.id === id); if (s) s.verdict = { pass: v!.pass, score: v!.score, issues: v!.issues }; });
      spendAi();
    }
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
export type { Scene };
