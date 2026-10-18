// AI stages. Each stage = a carefully engineered prompt + a strict JSON contract + a validator + a free code fallback.
// Code measures; AI imagines. The AI never sees anything it can't use, and anything it returns is checked before use.
import type { Project, Style, Line, Scene } from './types';
import { FONT_CHOICES } from './styles';

// ---------------------------------------------------------------- types
export interface SongReading {
  genre: string; subgenre: string; language: string; themes: string[]; story: string;
  arc: { section: string; feeling: string; intensity: number }[];
  imagery: string[]; places: string[]; characters: string[]; signatureLines: string[]; hotWords: string[];
}
export interface Direction {
  concept: string; world: string; mood: string;                 // mood = the colour-grade / lighting description used in every image prompt
  timeOfDay: string; wardrobe: string; motifs: string[]; locations: string[];
  palette: { background: string; text: string; accent: string; accent2: string; hot: string; sign: string };
  fonts: { lyric: string; hot: string; display: string; small: string };
  lyrics: { layout: 'lower-left' | 'lower-center' | 'center'; reveal: 'rise' | 'blur' | 'pop' | 'type'; caps: boolean; size: number };
  energy: number;                                                // 0 calm .. 1 maximum (drives zoom punches, shake, whip pans)
  grade: { bloom: number; grain: number; vignette: number; lightLeak: number; letterbox: number; colourSplitOnDrops: boolean };
  particles: Style['particles'];
  transitions: { section: Style['transitions']['section']; drop: Style['transitions']['drop'] };
  graphics: { placeSigns: boolean; locationCaptions: boolean; shoutStamps: boolean; titleOnDrops: boolean; opener: 'classic' | 'definition'; letterbox_credits: boolean };
  titleCard: { tagline: string; definition: string[] };
  why: string;
}
export interface SceneIdea { id: string; idea: string; artist: boolean; location: string; shot: string }
export interface ImageVerdict { pass: boolean; score: number; issues: string[]; fix: string }
export interface FrameNotes { lyricLayout?: Direction['lyrics']['layout']; lyricSize?: number; letterbox?: number; placeSigns?: boolean; locationCaptions?: boolean; notes: string[] }

// ---------------------------------------------------------------- what the engine can render (shown to the AI)
export const ENGINE_CATALOG = `What the video engine can render (choose only from these):
- Image scenes: one still per scene, animated with Ken Burns moves, zoom punches on kicks, whip pans, flash cuts. Cuts are placed on the beat by code.
- Lyrics: word-by-word on screen. layout: "lower-left" | "lower-center" | "center". reveal: "rise" (words slide up) | "blur" (blur to sharp) | "pop" (scale bounce) | "type" (typewriter). caps: true/false. size 60–120 (px at 1080p).
- Hot words: chosen words get the accent "hot" colour and display font.
- Fonts (exact names): ${FONT_CHOICES.join(', ')}.
- Palette: 6 hex colours — background (title/end cards), text, accent (highlights, foil titles), accent2 (second accent, drop boxes), hot (hot words), sign (place-sign plates).
- Particles: "embers" | "rain" | "snow" | "dust" | "none".
- Grade: bloom 0–0.5, grain 0–0.2, vignette 0–0.8, lightLeak 0–0.3, letterbox bars 0–120 px (0 = full frame, 66 = subtle, 92+ = strong cinematic), colourSplitOnDrops true/false.
- Transitions at section changes: "film-burn" | "light-sweep" | "flash" | "none". At hook drops: "flash" | "flash-rgb" | "none".
- Graphics: placeSigns (street/place names pop up as road signs), locationCaptions (lower-right place captions), shoutStamps (short shouted lines slam full-screen), titleOnDrops (song title lockup on the first drops), opener "classic" (artist + title) or "definition" (dictionary-entry card), letterbox_credits (artist/title text inside the bars).
- Alphabet songs only: giant letters, A–Z progress ruler and letter-shaped reveals switch on automatically by code; you don't choose them.`;

// ---------------------------------------------------------------- helpers
const clamp = (x: any, a: number, b: number, d: number) => (typeof x === 'number' && isFinite(x) ? Math.max(a, Math.min(b, x)) : d);
const oneOf = <T extends string>(x: any, opts: readonly T[], d: T): T => (opts.includes(x) ? x : d);
const str = (x: any, d = '', max = 400) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : d);
const strs = (x: any, max = 12, len = 80) => (Array.isArray(x) ? x.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim().slice(0, len)).slice(0, max) : []);
const HEX = /^#[0-9a-f]{6}$/i; const hex = (x: any, d: string) => (typeof x === 'string' && HEX.test(x.trim()) ? x.trim() : d);
const font = (x: any, d: string) => (FONT_CHOICES.includes(x) ? x : d);
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/** Measured facts about the song (code), formatted for the AI. */
export function songFacts(p: Project): string {
  const A = p.analysis!, f = A.features;
  const secEnergy = p.sections.map((s, i) => {
    const a = s[1], b = p.sections[i + 1]?.[1] ?? A.dur; const i0 = Math.floor(a / A.curveDt), i1 = Math.max(i0 + 1, Math.floor(b / A.curveDt));
    const v = A.rms.slice(i0, i1); const e = v.reduce((x, y) => x + y, 0) / Math.max(1, v.length);
    return `${s[0]} ${fmt(a)}–${fmt(b)} energy ${e.toFixed(2)}`;
  });
  return [`Title: "${p.meta.title}"${p.meta.artist ? ` by ${p.meta.artist}` : ''}`,
    `Length ${fmt(A.dur)}, tempo ${A.tempo.toFixed(0)} BPM${f ? `, key ${f.key} ${f.mode} (confidence ${f.keyConfidence}), loudness ${f.energy}, brightness ${f.brightness} Hz, rhythmic density ${f.density}/s, dynamics ${f.dynamics}` : ''}`,
    `Sections: ${secEnergy.join(' | ')}`,
    `Hook drops at: ${p.drops.map(fmt).join(', ') || 'none'}`,
    p.letters.length ? `This is an ALPHABET song (lines like "A for …"): ${p.letters.filter(l => l.kind === 'verse').map(l => `${l.ch}=${l.word}`).join(', ')}` : ''].filter(Boolean).join('\n');
}
function lyricsBlock(lines: Line[], max = 6000) {
  let out = '', sec = '';
  for (const l of lines) { if (l.sec !== sec) { out += `\n[${l.sec}]\n`; sec = l.sec; } out += `${fmt(l.start)} ${l.text}\n`; if (out.length > max) { out += '…\n'; break; } }
  return out.trim();
}

// ---------------------------------------------------------------- stage 1: song reading
export function readingPrompt(p: Project, userNotes = '') {
  return {
    system: `You are a music supervisor and lyric analyst preparing a brief for a music-video director. You read lyrics the way the artist meant them: slang, regional references, double meanings, the story underneath. You are precise and concrete — real nouns, real places, real images from the words, never generic filler like "vibes" or "energy". You work for any genre. Reply with JSON only.`,
    user: `${songFacts(p)}

Lyrics with timestamps:
${lyricsBlock(p.lines)}
${userNotes ? `\nThe artist's own notes about the song: ${userNotes}\n` : ''}
Read this song and return JSON:
{
 "genre": "main genre", "subgenre": "specific style", "language": "lyric language",
 "themes": ["3-6 themes, concrete"],
 "story": "2-3 sentences: who is speaking, to whom, what happens, how it feels",
 "arc": [{"section": "section name from the list", "feeling": "one or two words", "intensity": 0.0-1.0} ... one per section],
 "imagery": ["8-15 concrete visual images taken from or implied by the lyrics"],
 "places": ["real places, streets, cities named or implied; empty if none"],
 "characters": ["people in the song: the narrator, a lover, a crew, family…"],
 "signatureLines": ["the 3-6 lines that should hit hardest on screen, copied exactly"],
 "hotWords": ["4-10 single words worth highlighting on screen, in CAPS"]
}`,
  };
}
export function validReading(x: any): SongReading {
  return { genre: str(x?.genre, 'unknown', 40), subgenre: str(x?.subgenre, '', 60), language: str(x?.language, 'English', 30), themes: strs(x?.themes, 6), story: str(x?.story, '', 600),
    arc: Array.isArray(x?.arc) ? x.arc.slice(0, 20).map((a: any) => ({ section: str(a?.section, '', 30), feeling: str(a?.feeling, '', 40), intensity: clamp(a?.intensity, 0, 1, 0.5) })) : [],
    imagery: strs(x?.imagery, 15, 120), places: strs(x?.places, 12), characters: strs(x?.characters, 8), signatureLines: strs(x?.signatureLines, 6, 160), hotWords: strs(x?.hotWords, 10, 24).map(w => w.toUpperCase()) };
}
/** Free fallback: themes from word frequency, hot words from the hooks. */
export function autoReading(p: Project): SongReading {
  const STOP = new Set('the a an and or but to of in on at for with from by is are was were be it its this that i im me my you your we our they them he she his her what who when where why how all just like up down out so if then got get can aint dont yeah oh uh ayy know now one'.split(' '));
  const freq = new Map<string, number>();
  for (const l of p.lines) for (const w of l.text.toLowerCase().split(/[^a-z']+/)) if (w.length > 3 && !STOP.has(w)) freq.set(w, (freq.get(w) || 0) + (l.style === 'hook' ? 2 : 1));
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
  const hooks = p.lines.filter(l => l.style === 'hook');
  return { genre: 'unknown', subgenre: '', language: 'English', themes: top.slice(0, 5), story: '', arc: p.sections.map(s => ({ section: s[0], feeling: '', intensity: /hook|bridge/.test(s[0]) ? 0.9 : 0.6 })),
    imagery: top.slice(0, 10), places: [], characters: [], signatureLines: (hooks.length ? hooks : p.lines).slice(0, 3).map(l => l.text), hotWords: top.slice(0, 6).map(w => w.toUpperCase()) };
}

// ---------------------------------------------------------------- stage 2: creative direction
export function directionPrompt(p: Project, r: SongReading, userNotes = '') {
  return {
    system: `You are an award-winning music-video director and art director. You design one cohesive visual language per song — concept, world, light, colour, type, motion and graphics — that fits THIS song's genre, story and energy. A gospel ballad, a drill track, a country love song and a club record must look completely different. Make bold, specific, tasteful choices a real director would defend. You can only use what the engine can render. Reply with JSON only.`,
    user: `${songFacts(p)}

Song reading (from the music supervisor):
${JSON.stringify(r)}
${userNotes ? `\nThe artist's own direction (follow it): ${userNotes}\n` : ''}
${ENGINE_CATALOG}

Rules:
- Every choice must come from the song: its genre, story, setting, era and the emotional arc. No default look.
- Colours: a deliberate palette with real contrast; text must be readable over imagery. Use hex.
- Fonts: pairing that matches the genre (e.g. elegant serif for soul or gospel, condensed bold for rap, handwritten for intimate acoustic). Exact names from the list.
- energy: match the song (0.2 slow ballad … 0.9 hard-hitting club/rap).
- letterbox: 0 for bright upbeat pop, 66–92 for cinematic or moody songs.
- placeSigns only if the lyrics name real streets/places; shoutStamps only if there are short shouted lines; opener "definition" only if the title is a word or phrase worth defining.
- mood is the lighting + colour-grade description that will be appended to EVERY image prompt (e.g. "warm golden-hour sun, amber highlights, teal shadows, soft haze"). Keep it 15-30 words, photographic language.
- wardrobe: what the artist wears in every scene (keeps continuity). locations: 4-8 recurring settings that fit the story.

Return JSON:
{
 "concept": "one-sentence pitch of the video",
 "world": "2 sentences: where and when this video lives, its visual story",
 "mood": "lighting + grade description for every image prompt",
 "timeOfDay": "how light changes across the video (e.g. dusk into night)",
 "wardrobe": "the artist's look", "motifs": ["2-4 recurring visual motifs"], "locations": ["4-8 settings"],
 "palette": {"background": "#hex", "text": "#hex", "accent": "#hex", "accent2": "#hex", "hot": "#hex", "sign": "#hex"},
 "fonts": {"lyric": "", "hot": "", "display": "", "small": ""},
 "lyrics": {"layout": "lower-left|lower-center|center", "reveal": "rise|blur|pop|type", "caps": true, "size": 84},
 "energy": 0.0-1.0,
 "grade": {"bloom": 0.2, "grain": 0.08, "vignette": 0.55, "lightLeak": 0.1, "letterbox": 66, "colourSplitOnDrops": false},
 "particles": "embers|rain|snow|dust|none",
 "transitions": {"section": "film-burn|light-sweep|flash|none", "drop": "flash|flash-rgb|none"},
 "graphics": {"placeSigns": false, "locationCaptions": false, "shoutStamps": false, "titleOnDrops": true, "opener": "classic|definition", "letterbox_credits": false},
 "titleCard": {"tagline": "short end-card line", "definition": ["headword with·syl·la·bles", "/ phonetic /   part of speech", "1.  first meaning (tie to the song)", "2.  second meaning"]},
 "why": "2 sentences explaining the choices"
}`,
  };
}
export function validDirection(x: any, fallback: Direction): Direction {
  const d = fallback;
  const L = x?.lyrics ?? {}, G = x?.grade ?? {}, F = x?.fonts ?? {}, P = x?.palette ?? {}, T = x?.transitions ?? {}, GR = x?.graphics ?? {};
  return {
    concept: str(x?.concept, d.concept, 240), world: str(x?.world, d.world, 500), mood: str(x?.mood, d.mood, 300), timeOfDay: str(x?.timeOfDay, d.timeOfDay, 120),
    wardrobe: str(x?.wardrobe, d.wardrobe, 200), motifs: strs(x?.motifs, 4, 80).length ? strs(x?.motifs, 4, 80) : d.motifs, locations: strs(x?.locations, 8, 100).length ? strs(x?.locations, 8, 100) : d.locations,
    palette: { background: hex(P.background, d.palette.background), text: hex(P.text, d.palette.text), accent: hex(P.accent, d.palette.accent), accent2: hex(P.accent2, d.palette.accent2), hot: hex(P.hot, d.palette.hot), sign: hex(P.sign, d.palette.sign) },
    fonts: { lyric: font(F.lyric, d.fonts.lyric), hot: font(F.hot, d.fonts.hot), display: font(F.display, d.fonts.display), small: font(F.small, d.fonts.small) },
    lyrics: { layout: oneOf(L.layout, ['lower-left', 'lower-center', 'center'] as const, d.lyrics.layout), reveal: oneOf(L.reveal, ['rise', 'blur', 'pop', 'type'] as const, d.lyrics.reveal), caps: typeof L.caps === 'boolean' ? L.caps : d.lyrics.caps, size: clamp(L.size, 60, 120, d.lyrics.size) },
    energy: clamp(x?.energy, 0, 1, d.energy),
    grade: { bloom: clamp(G.bloom, 0, 0.5, d.grade.bloom), grain: clamp(G.grain, 0, 0.2, d.grade.grain), vignette: clamp(G.vignette, 0, 0.8, d.grade.vignette), lightLeak: clamp(G.lightLeak, 0, 0.3, d.grade.lightLeak), letterbox: clamp(G.letterbox, 0, 120, d.grade.letterbox), colourSplitOnDrops: typeof G.colourSplitOnDrops === 'boolean' ? G.colourSplitOnDrops : d.grade.colourSplitOnDrops },
    particles: oneOf(x?.particles, ['embers', 'rain', 'snow', 'dust', 'none'] as const, d.particles),
    transitions: { section: oneOf(T.section, ['film-burn', 'light-sweep', 'flash', 'none'] as const, d.transitions.section), drop: oneOf(T.drop, ['flash', 'flash-rgb', 'none'] as const, d.transitions.drop) },
    graphics: { placeSigns: !!GR.placeSigns, locationCaptions: !!GR.locationCaptions, shoutStamps: !!GR.shoutStamps, titleOnDrops: GR.titleOnDrops !== false, opener: oneOf(GR.opener, ['classic', 'definition'] as const, d.graphics.opener), letterbox_credits: !!GR.letterbox_credits },
    titleCard: { tagline: str(x?.titleCard?.tagline, d.titleCard.tagline, 80), definition: strs(x?.titleCard?.definition, 4, 120).length ? strs(x?.titleCard?.definition, 4, 120) : d.titleCard.definition },
    why: str(x?.why, d.why, 400),
  };
}
/** Free fallback: a neutral direction derived only from measured features (no genre assumptions beyond the numbers). */
export function autoDirection(p: Project, r: SongReading): Direction {
  const f = p.analysis?.features, tempo = p.analysis?.tempo ?? 100;
  const energy = Math.max(0.2, Math.min(0.95, (f ? f.energy * 0.5 + Math.min(1, f.density / 6) * 0.3 : 0.4) + (tempo > 120 ? 0.15 : 0)));
  const dark = f ? f.mode === 'minor' || f.brightness < 2800 : true;
  const hooks = p.lines.filter(l => l.style === 'hook');
  const line = (hooks[0] ?? p.lines[0])?.text?.replace(/[,.!?]+$/, '') ?? p.meta.title;
  return {
    concept: `${p.meta.title}: a cinematic performance-and-story video cut to ${Math.round(tempo)} BPM.`, world: 'Grounded, cinematic locations drawn from the lyrics.',
    mood: dark ? 'moody night lighting, deep shadows, rich highlights, soft haze, filmic contrast' : 'warm natural daylight, soft glow, gentle contrast, airy filmic colour',
    timeOfDay: dark ? 'dusk into night' : 'afternoon into golden hour', wardrobe: '', motifs: [], locations: [],
    palette: dark ? { background: '#0b0c10', text: '#f2efe8', accent: '#d9b25f', accent2: '#d6453d', hot: '#d9b25f', sign: '#1f5f8b' } : { background: '#14110f', text: '#fffaf0', accent: '#ffb547', accent2: '#ff6b4a', hot: '#ffb547', sign: '#2f7d4f' },
    fonts: energy > 0.6 ? { lyric: 'Anton', hot: 'Permanent Marker', display: 'Anton', small: 'Oswald' } : { lyric: 'Bebas Neue', hot: 'Playfair Display', display: 'Playfair Display', small: 'DM Mono' },
    lyrics: { layout: energy > 0.6 ? 'lower-left' : 'lower-center', reveal: energy > 0.6 ? 'rise' : 'blur', caps: true, size: 84 },
    energy, grade: { bloom: 0.22, grain: 0.08, vignette: 0.55, lightLeak: dark ? 0 : 0.12, letterbox: 66, colourSplitOnDrops: energy > 0.7 },
    particles: dark ? 'dust' : 'embers', transitions: { section: energy > 0.6 ? 'flash' : 'light-sweep', drop: energy > 0.7 ? 'flash-rgb' : 'flash' },
    graphics: { placeSigns: false, locationCaptions: false, shoutStamps: p.lines.some(l => l.stamp), titleOnDrops: true, opener: 'classic', letterbox_credits: false },
    titleCard: { tagline: line, definition: [p.meta.title.toLowerCase(), '/ noun /', `1.  ${line}.`, `2.  ${p.meta.artist || 'the artist'}.`] }, why: 'Chosen from the song’s measured tempo, energy and brightness.',
  };
}
/** Turn a direction into the renderer's Style. */
export function directionToStyle(d: Direction, hasLetters: boolean): Style {
  const tint = (h: string, a: number) => { const n = parseInt(h.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
  const e = d.energy;
  return {
    name: 'Custom',
    palette: { bg: d.palette.background, text: d.palette.text, accent: d.palette.accent, accent2: d.palette.accent2, hot: d.palette.hot, sign: d.palette.sign, signAlt: d.palette.accent2, shadowTint: tint(d.palette.sign, 0.35), highlightTint: tint(d.palette.accent, 0.22) },
    fonts: { lyric: d.fonts.lyric, hot: d.fonts.hot, ui: d.fonts.small, display: d.fonts.display },
    lyrics: { layout: d.lyrics.layout, size: d.lyrics.size, hookScale: 1.2, reveal: d.lyrics.reveal, case: d.lyrics.caps ? 'upper' : 'as-is', hotWords: [], alliteration: hasLetters, activeColor: d.palette.accent },
    motion: { kickZoom: 0.004 + 0.014 * e, cutPunch: 0.015 + 0.04 * e, shake: Math.round(e * 5 * 2) / 2, whipPans: e > 0.55 && !hasLetters, letterMask: hasLetters },
    grade: { bloom: d.grade.bloom, grain: d.grade.grain, vignette: d.grade.vignette, lightLeak: d.grade.lightLeak, leakColor: (() => { const n = parseInt(d.palette.accent.slice(1), 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; })(), letterbox: d.grade.letterbox, chroma: d.grade.colourSplitOnDrops },
    particles: d.particles,
    features: { signs: d.graphics.placeSigns, captions: d.graphics.locationCaptions, bigLetters: hasLetters, ruler: hasLetters, dictionaryOpen: d.graphics.opener === 'definition', dropLockup: d.graphics.titleOnDrops, stamps: d.graphics.shoutStamps, footer: d.graphics.letterbox_credits && d.grade.letterbox >= 60 },
    transitions: { section: d.transitions.section, drop: d.grade.colourSplitOnDrops && d.transitions.drop === 'flash' ? 'flash-rgb' : d.transitions.drop },
  };
}

// ---------------------------------------------------------------- stage 3: scene writing
export interface Slot { id: string; at: number; section: string; seconds: number; lyric: string; word?: string; energy: number; letter?: string }
export function slotsFor(p: Project): Slot[] {
  const A = p.analysis!;
  return p.scenes.map(s => {
    const shots = p.shots.filter(x => x.img === s.id); const at = shots[0]?.from ?? 0;
    const sec = [...p.sections].reverse().find(x => at >= x[1])?.[0] ?? '';
    const i0 = Math.floor(at / A.curveDt), v = A.rms.slice(i0, i0 + Math.max(1, Math.round(2 / A.curveDt)));
    return { id: s.id, at, section: sec, seconds: +shots.reduce((a, x) => a + x.to - x.from, 0).toFixed(1), lyric: s.lyric ?? '', word: s.word, energy: +(v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)).toFixed(2), letter: shots.find(x => x.letter)?.letter };
  }).sort((a, b) => a.at - b.at);
}
export function scenesPrompt(p: Project, r: SongReading, d: Direction, hasArtistPhotos: boolean, userNotes = '') {
  const slots = slotsFor(p);
  return {
    system: `You are the director writing the shot list for a music video. Each scene is ONE photoreal still that code will animate and cut on the beat under a specific lyric. Write scenes a cinematographer could shoot: a specific place, a specific action, a camera angle and the light. Tell the song's story across the video and build with its energy. Keep continuity (same wardrobe, recurring locations and motifs). Vary shot sizes (wide, medium, close-up, detail, overhead, low angle) and never repeat the same setting back to back. Never describe the artist's face or body type (reference photos handle identity). Never ask for readable text, signs with words, logos or captions in the image. Reply with JSON only.`,
    user: `${songFacts(p)}

Story: ${r.story}
Themes: ${r.themes.join(', ')}. Imagery from the lyrics: ${r.imagery.join('; ')}. Places: ${r.places.join(', ') || 'none named'}. Characters: ${r.characters.join(', ') || 'the artist'}.
Direction — concept: ${d.concept} World: ${d.world} Light: ${d.timeOfDay}. Wardrobe: ${d.wardrobe || 'artist’s own style'}. Motifs: ${d.motifs.join(', ')}. Locations: ${d.locations.join(', ')}.
${hasArtistPhotos ? 'The artist uploaded photos, so they can appear in scenes (set "artist": true). Feature the artist in roughly 60-75% of scenes, more in hooks; use others for atmosphere, crowd, details and story characters.' : 'No artist photos were uploaded: set "artist": false for every scene and tell the story through places, objects, crowds and anonymous characters (silhouettes, hands, backs, figures in the distance).'}
${p.letters.length ? 'Alphabet song: scenes with a "word" must visually embody that word (a clear visual metaphor), still in this video’s world.' : ''}
${userNotes ? `Artist’s notes (follow them): ${userNotes}\n` : ''}
Scene slots in playback order (id, time, section, seconds on screen, energy 0-1, lyric${p.letters.length ? ', word' : ''}):
${slots.map(s => `${s.id} | ${fmt(s.at)} | ${s.section} | ${s.seconds}s | ${s.energy} | "${s.lyric.slice(0, 110)}"${s.word ? ` | word: ${s.word}` : ''}`).join('\n')}

Return JSON: {"scenes": [{"id": "S01", "idea": "under 40 words: setting, action, camera angle, light", "artist": true, "location": "one of the locations", "shot": "wide|medium|close-up|detail|overhead|low angle"}, … one for EVERY id above]}`,
  };
}
export function validScenes(x: any, ids: string[], hasPhotos: boolean): SceneIdea[] {
  const list: any[] = Array.isArray(x?.scenes) ? x.scenes : x && typeof x === 'object' ? Object.entries(x).map(([id, v]) => ({ id, ...(typeof v === 'string' ? { idea: v } : (v as any)) })) : [];
  const byId = new Map(list.filter(s => s && typeof s.id === 'string').map(s => [s.id, s]));
  return ids.filter(id => byId.has(id)).map(id => { const s = byId.get(id); return { id, idea: str(s.idea, '', 320), artist: hasPhotos && s.artist !== false, location: str(s.location, '', 100), shot: str(s.shot, '', 30) }; }).filter(s => s.idea);
}

// ---------------------------------------------------------------- image prompt (code)
export function imagePrompt(p: Project, s: Scene, d: Direction | undefined, provider: string): string {
  if (s.custom) return s.prompt;
  const id = s.withAvatar ? `The main character is the person in the reference photos: keep their exact face, hairstyle, skin tone and build.${d?.wardrobe ? ` Wardrobe: ${d.wardrobe}.` : ''}${p.avatar.description ? ` ${p.avatar.description}.` : ''}` : '';
  const scene = s.idea ? s.idea.replace(/\.$/, '') : `A cinematic scene for the lyric "${s.lyric ?? ''}"`;
  const word = s.word ? ` The image embodies the word "${s.word}".` : '';
  const layout = p.style.lyrics.layout === 'lower-left' ? 'keep the lower-left area calm for lyrics' : 'keep the lower third calm for lyrics';
  const vertical = p.height > p.width;
  const look = d ? `${d.mood}. ${d.world}` : 'cinematic lighting, filmic colour grade';
  // phrasing tuned per model family: natural sentences for gpt-image and Gemini, tag-like clarity for FLUX
  if (provider === 'fal') return `${scene}.${word} ${id} Photoreal cinematic film still, ${vertical ? 'vertical 9:16' : 'wide 16:9'}, 35mm anamorphic, shallow depth of field, ${look}, ${layout}, no text, no logos, no watermark.`.replace(/\s+/g, ' ');
  return `${id} Scene: ${scene}.${word} Look: ${look}. Photoreal cinematic music-video film still, ${vertical ? 'vertical 9:16 frame' : 'wide 16:9 frame'}, 35mm anamorphic lens, shallow depth of field, natural skin texture, ${layout}. No text, letters, captions, logos or watermarks anywhere in the image.`.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- stage 4: image check (vision)
export function imageCheckPrompt(s: Scene, hasRef: boolean) {
  return {
    system: `You are a strict music-video art director approving generated stills before they go into the edit. Approve only images a professional would ship. Reply with JSON only.`,
    user: `${hasRef ? 'The FIRST image is a reference photo of the artist. The LAST image is the generated still to judge.' : 'Judge the attached generated still.'}
Intended scene: ${s.idea || s.lyric || ''}${s.word ? ` (should embody "${s.word}")` : ''}.
Check: ${hasRef && s.withAvatar ? '1) the main person clearly matches the reference (face, hair, skin tone) — a different-looking person is a fail; ' : ''}2) no visible text, letters, captions, logos or watermarks; 3) no warped hands, extra fingers, melted faces or broken objects; 4) it shows the intended scene; 5) cinematic, well-lit, sharp.
Return JSON: {"pass": true|false, "score": 0-10, "issues": ["short issue", …], "fix": "one sentence to add to the prompt to fix it, or empty"}`,
  };
}
export function validVerdict(x: any): ImageVerdict {
  const score = clamp(x?.score, 0, 10, 7);
  return { pass: typeof x?.pass === 'boolean' ? x.pass && score >= 6 : score >= 6, score, issues: strs(x?.issues, 5, 120), fix: str(x?.fix, '', 240) };
}

// ---------------------------------------------------------------- stage 5: frame check (vision)
export function frameCheckPrompt(p: Project, times: number[]) {
  return {
    system: `You are a finishing editor reviewing rendered frames of a lyric music video before export. You catch layout problems a viewer would notice. Reply with JSON only.`,
    user: `These are ${times.length} rendered frames (at ${times.map(fmt).join(', ')}). Current layout: lyrics ${p.style.lyrics.layout}, size ${p.style.lyrics.size}, letterbox ${p.style.grade.letterbox}px, place signs ${p.style.features.signs}, captions ${p.style.features.captions}.
Look for: lyrics covering faces or the main subject; lyrics hard to read over bright areas; text clipped by the frame or letterbox; graphics colliding with each other; anything that looks broken.
Only change what clearly needs it. Allowed changes: lyricLayout ("lower-left" | "lower-center" | "center"), lyricSize (60-120), letterbox (0-120), placeSigns (true/false), locationCaptions (true/false).
Return JSON: {"lyricLayout": optional, "lyricSize": optional, "letterbox": optional, "placeSigns": optional, "locationCaptions": optional, "notes": ["what you saw and why you changed it, or 'looks good'"]}`,
  };
}
export function validFrameNotes(x: any): FrameNotes {
  const n: FrameNotes = { notes: strs(x?.notes, 6, 200) };
  if (['lower-left', 'lower-center', 'center'].includes(x?.lyricLayout)) n.lyricLayout = x.lyricLayout;
  if (typeof x?.lyricSize === 'number') n.lyricSize = clamp(x.lyricSize, 60, 120, 84);
  if (typeof x?.letterbox === 'number') n.letterbox = clamp(x.letterbox, 0, 120, 66);
  if (typeof x?.placeSigns === 'boolean') n.placeSigns = x.placeSigns;
  if (typeof x?.locationCaptions === 'boolean') n.locationCaptions = x.locationCaptions;
  return n;
}
