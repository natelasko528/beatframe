// The creative director. Code derives a complete brief from the song (analysis + lyrics) for free;
// an optional single LLM call upgrades it with real ideas. The LLM only writes ideas (short scene
// descriptions, mood, palette); code expands them into full image prompts, so token use stays tiny.
import type { Project, Style, Line } from './types';
import { PRESETS, MOODS } from './styles';

export interface Brief {
  source: 'auto' | 'ai';
  concept: string;
  mood: string;                       // a MOODS key or free text
  preset: keyof typeof PRESETS | string;
  palette: { accent: string; accent2: string; text: string; hot: string };
  particles: Style['particles'];
  cutting: 'per-line' | 'alphabet' | 'beats';
  hotWords: string[];
  signWords: string[];
  city: string;
  tagline: string;
  definition: string[];
  sceneIdeas: Record<string, string>; // scene id -> short visual idea (AI); empty in auto mode
}

const STOP = new Set('the a an and or but to of in on at for with from by is are was were be been it its this that these those i im i\'m me my mine you your yours we our us they them their he him his she her hers what who when where why how all any every some no not do does did got get gets just like up down out off over so if then than too very can cant can\'t ain\'t aint wanna gonna yeah ayy uh oh let lets let\'s know whole still now never ever one two make made making'.split(' '));
const CITIES = ['Milwaukee', 'Chicago', 'Detroit', 'Atlanta', 'Houston', 'Dallas', 'Memphis', 'Nashville', 'New York', 'Brooklyn', 'Bronx', 'Harlem', 'Queens', 'Los Angeles', 'LA', 'Compton', 'Oakland', 'Bay Area', 'San Francisco', 'Seattle', 'Miami', 'Orlando', 'Tampa', 'New Orleans', 'Baltimore', 'Philly', 'Philadelphia', 'Boston', 'DC', 'Washington', 'St. Louis', 'Saint Louis', 'Minneapolis', 'Cleveland', 'Columbus', 'Cincinnati', 'Indianapolis', 'Kansas City', 'Denver', 'Phoenix', 'Las Vegas', 'Vegas', 'Toronto', 'London', 'Paris', 'Lagos', 'Kingston', 'Charlotte', 'Raleigh', 'Pittsburgh', 'Buffalo', 'Newark', 'Jersey', 'Austin', 'San Antonio', 'San Diego', 'Portland', 'Salt Lake', 'Omaha', 'Louisville', 'Birmingham', 'Jackson', 'Baton Rouge', 'Richmond', 'Norfolk', 'Madison', 'Green Bay', 'Racine', 'Kenosha'];

const MOOD_RULES: [RegExp, string][] = [
  [/\b(boss|ceo|money|cash|bands|legacy|king|crown|throne|penthouse|luxury|diamonds?|gold|empire|hustl\w*)\b/i, 'After-dark luxury'],
  [/\b(god|jesus|lord|faith|pray|prayer|blessed|grace|heaven|church|testify|amen)\b/i, 'Heavenly light'],
  [/\b(summer|bbq|barbecue|cookout|grill|sunshine|beach|lake ?front|block party|sunny)\b/i, 'Golden summer'],
  [/\b(neon|club|strobe|rave|party all night|after ?party|lights flashing)\b/i, 'Neon night'],
  [/\b(trenches|struggle|pain|grind|cold streets|block hot|survive|real ones)\b/i, 'Gritty street'],
];
const PRESET_FOR_MOOD: Record<string, string> = { 'After-dark luxury': 'alphabet', 'Golden summer': 'summer', 'Neon night': 'neon', 'Heavenly light': 'gospel', 'Gritty street': 'alphabet' };
const PARTICLES_FOR_MOOD: Record<string, Style['particles']> = { 'After-dark luxury': 'rain', 'Golden summer': 'embers', 'Neon night': 'dust', 'Heavenly light': 'dust', 'Gritty street': 'rain' };

function words(lines: Line[]) { return lines.flatMap(l => l.text.split(/[^A-Za-z']+/)).filter(Boolean); }

/** Free, code-only brief derived from the song. Defaults follow the A to Z video's look. */
export function autoBrief(p: Project): Brief {
  const all = p.lines.map(l => l.text).join('\n');
  const f = p.analysis?.features;
  let mood = 'After-dark luxury';                                   // A to Z default
  const scores = MOOD_RULES.map(([re, m]) => [((all.match(new RegExp(re, 'gi')) || []).length), m] as const).sort((a, b) => b[0] - a[0]);
  // the A to Z look is the house default; switch only when the lyrics clearly point elsewhere
  const lux = scores.find(s => s[1] === 'After-dark luxury')?.[0] ?? 0;
  if (scores[0][1] !== 'After-dark luxury' && scores[0][0] >= 3 && scores[0][0] > lux * 1.5) mood = scores[0][1];
  else if (f && f.mode === 'major' && f.brightness > 3600 && f.energy < 0.55) mood = 'Golden summer';
  const preset = PRESET_FOR_MOOD[mood] ?? 'alphabet';
  const base = PRESETS[preset];
  // hot words: most repeated meaningful words in the hooks (fallback: whole song)
  const hookLines = p.lines.filter(l => l.style === 'hook');
  const freq = new Map<string, number>();
  for (const w of words(hookLines.length ? hookLines : p.lines)) { const k = w.toUpperCase(); if (k.length > 3 && !STOP.has(w.toLowerCase())) freq.set(k, (freq.get(k) || 0) + 1); }
  const hotWords = [...freq.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
  const city = CITIES.map(c => [c, (all.match(new RegExp(`\\b${c.replace('.', '\\.')}\\b`, 'g')) || []).length] as const).sort((a, b) => b[1] - a[1]).find(([, n]) => n > 0)?.[0] ?? '';
  const firstHook = hookLines[0]?.text ?? p.lines[0]?.text ?? p.meta.title;
  const cutting = p.letters.length >= 6 ? 'alphabet' : (p.analysis && p.analysis.tempo > 135 ? 'beats' : 'per-line');
  const title = p.meta.title || 'Untitled';
  return {
    source: 'auto',
    concept: `${title}: ${mood.toLowerCase()} visuals cut to ${Math.round(p.analysis?.tempo ?? 0)} BPM${city ? ` across ${city}` : ''}.`,
    mood, preset, particles: PARTICLES_FOR_MOOD[mood] ?? base.particles,
    palette: { accent: base.palette.accent, accent2: base.palette.accent2, text: base.palette.text, hot: base.palette.hot },
    cutting, hotWords, signWords: [], city,
    tagline: firstHook.replace(/[,.!?]+$/, ''),
    definition: [title.toLowerCase(), '/ noun /', `1.  ${firstHook.replace(/[,.!?]+$/, '')}.`, `2.  ${p.meta.artist || 'The artist'}.${city ? `  See also: ${city.toUpperCase()}.` : ''}`],
    sceneIdeas: {},
  };
}

/** Compact context for the LLM: everything it needs to have good ideas, nothing it doesn't. */
export function briefRequest(p: Project, auto: Brief): { system: string; user: string } {
  const f = p.analysis?.features;
  const lyrics = p.lines.map(l => `[${l.sec}] ${l.text}`).join('\n').slice(0, 5000);
  const slots = p.scenes.map(s => {
    const lyric = (s.prompt.match(/lyric "([^"]+)"/) || [])[1] ?? '';
    const word = (s.prompt.match(/embodies the word "([^"]+)"/) || [])[1];
    return `${s.id}${word ? ` [letter word: ${word}]` : ''}: ${lyric}`;
  }).join('\n');
  const system = 'You are the creative director of a cinematic lyric music video. You only write ideas; code turns them into image prompts and edits. Be specific, visual, varied and true to the lyrics. Keep every scene idea under 35 words: setting, action, camera angle, lighting. Never describe the artist\'s face (reference photos handle identity). Never put text or signs with words in scenes. Reply with JSON only.';
  const user = `Song: "${p.meta.title}" by ${p.meta.artist || 'unknown artist'}
Music: ${Math.round(p.analysis?.tempo ?? 0)} BPM, ${f ? `${f.key} ${f.mode}, energy ${f.energy}, brightness ${f.brightness} Hz` : ''}; sections: ${p.sections.map(s => s[0]).join(' > ')}
Code suggestion to improve on: mood "${auto.mood}", look "${auto.preset}", city "${auto.city}", hot words ${JSON.stringify(auto.hotWords)}
Available moods: ${Object.keys(MOODS).join(', ')} (or invent one). Available looks: ${Object.keys(PRESETS).join(', ')}.

Lyrics:
${lyrics}

Scene slots (id: lyric it plays under):
${slots}

Return JSON:
{"concept": "one sentence", "mood": "...", "look": "alphabet|summer|neon|gospel", "palette": {"accent": "#hex", "accent2": "#hex", "text": "#hex", "hot": "#hex"}, "particles": "rain|embers|snow|dust|none", "hotWords": ["UP TO 8 WORDS"], "signWords": ["real street or place names from the lyrics"], "city": "...", "tagline": "short end-card line", "scenes": {"<id>": "idea", ...every slot id}}`;
  return { system, user };
}

const HEX = /^#[0-9a-f]{6}$/i;
export function mergeBrief(auto: Brief, ai: any): Brief {
  const b: Brief = { ...auto, source: 'ai', palette: { ...auto.palette }, sceneIdeas: {} };
  if (typeof ai?.concept === 'string') b.concept = ai.concept.slice(0, 240);
  if (typeof ai?.mood === 'string' && ai.mood.trim()) b.mood = ai.mood.trim().slice(0, 80);
  if (typeof ai?.look === 'string' && PRESETS[ai.look]) b.preset = ai.look;
  for (const k of ['accent', 'accent2', 'text', 'hot'] as const) if (HEX.test(ai?.palette?.[k] ?? '')) b.palette[k] = ai.palette[k];
  if (['rain', 'embers', 'snow', 'dust', 'none'].includes(ai?.particles)) b.particles = ai.particles;
  if (Array.isArray(ai?.hotWords)) b.hotWords = ai.hotWords.filter((w: any) => typeof w === 'string').map((w: string) => w.toUpperCase().trim()).filter(Boolean).slice(0, 10);
  if (Array.isArray(ai?.signWords)) b.signWords = ai.signWords.filter((w: any) => typeof w === 'string' && w.length < 40).slice(0, 12);
  if (typeof ai?.city === 'string') b.city = ai.city.slice(0, 60);
  if (typeof ai?.tagline === 'string' && ai.tagline.trim()) b.tagline = ai.tagline.slice(0, 80);
  if (ai?.scenes && typeof ai.scenes === 'object') for (const [id, v] of Object.entries(ai.scenes)) if (typeof v === 'string' && v.trim()) b.sceneIdeas[id] = v.trim().slice(0, 400);
  return b;
}

/** Apply a brief to the project's look and plan. Returns nothing; mutates p. */
export function applyBrief(p: Project, b: Brief) {
  const base = structuredClone(PRESETS[b.preset] ?? PRESETS.alphabet);
  base.palette = { ...base.palette, ...b.palette };
  base.particles = b.particles;
  base.lyrics.hotWords = b.hotWords;
  // letter features only when the song actually runs letters
  if (!p.letters.length) { base.features.bigLetters = false; base.features.ruler = false; base.motion.letterMask = false; base.lyrics.alliteration = false; }
  p.style = base;
  p.plan.mode = b.cutting;
  p.meta.tagline = b.tagline;
  p.meta.definition = b.definition;
}

/** Cap the number of distinct scenes (cost control). Extra shots re-use the closest earlier scene. */
export function capScenes(p: Project, budget: number) {
  const keepLetters = p.plan.mode === 'alphabet';
  const isLetter = (id: string) => p.shots.some(s => s.img === id && s.letter);
  if (keepLetters) budget = Math.max(budget, p.scenes.filter(s => isLetter(s.id)).length + 4);   // every letter keeps its own scene
  if (p.scenes.length <= budget) return;
  const uses = new Map<string, number>(); p.shots.forEach(s => s.img && uses.set(s.img, (uses.get(s.img) || 0) + (s.to - s.from)));
  const ranked = [...p.scenes].sort((a, b) => (keepLetters ? Number(isLetter(b.id)) - Number(isLetter(a.id)) : 0) || (uses.get(b.id) || 0) - (uses.get(a.id) || 0));
  const keep = new Set(ranked.slice(0, budget).map(s => s.id));
  const keptOrder = p.scenes.filter(s => keep.has(s.id)).map(s => s.id);
  // re-point dropped shots at the most recent kept scene that isn't the neighbouring shot's image
  for (let i = 0; i < p.shots.length; i++) {
    const s = p.shots[i]; if (!s.img || keep.has(s.img)) continue;
    const prevImg = p.shots[i - 1]?.img, nextImg = p.shots[i + 1]?.img;
    let pick = '';
    for (let j = i - 2; j >= 0 && !pick; j--) { const c = p.shots[j].img; if (c && keep.has(c) && c !== prevImg && c !== nextImg) pick = c; }
    s.img = pick || keptOrder.find(c => c !== prevImg && c !== nextImg) || keptOrder[0];
  }
  p.scenes = p.scenes.filter(s => keep.has(s.id));
}
