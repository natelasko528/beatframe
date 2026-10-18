// Template-based scene prompts (no AI needed). AI ideas from stages.ts slot into these templates.
import { MOODS } from './styles';

// keyword -> visual. First matches win; several can combine.
const VISUALS: [RegExp, string][] = [
  [/grill|bbq|barbecue|cookout|brats|burgers|charcoal/i, 'a smoking charcoal grill at a backyard cookout, friends with red cups'],
  [/lake|lakefront|shore|beach|water/i, 'the lakefront with the city skyline glowing across the water'],
  [/cash|money|bands|currency|paper|racks|stack/i, 'stacks of cash and a money counter on a dark desk'],
  [/ride|riding|drive|cruise|car|whip|lowrider|cadillac|top down/i, 'cruising in a glossy classic car down a city avenue'],
  [/stage|crowd|fans|show|concert/i, 'a big concert stage with a sea of fans and light beams'],
  [/studio|mic|verse|bars|booth|record/i, 'a recording studio booth with a gold microphone'],
  [/chess|strateg|checkmate|king|crown|throne/i, 'a regal setting with a gold crown and a black and gold chessboard'],
  [/snow|winter|cold|freez/i, 'a snowy city street at night under streetlights'],
  [/rain|storm/i, 'a rain-slick street with reflections and steam'],
  [/roof|rooftop|skyline|city lights|downtown/i, 'a rooftop overlooking the downtown skyline'],
  [/club|party|dance|turn up|lit/i, 'a packed party with people dancing under string lights'],
  [/church|god|faith|pray|blessed|heaven|grace/i, 'golden light streaming into a quiet church, hands raised'],
  [/family|mama|kids|son|daughter|block/i, 'a neighborhood block with family and kids, warm community energy'],
  [/fight|gym|box|hustle|grind|work/i, 'a gritty gym or work site at dawn, sweat and determination'],
  [/business|brand|boss|office|ceo|legacy|build/i, 'a sleek office tower lobby, a sharp suit, boss energy'],
  [/fire|flame|hot|heat/i, 'flames and glowing embers in the night'],
  [/treasure|gold|diamond|jewel|chain/i, 'gold jewelry and a glowing treasure chest'],
  [/win|winner|champion|trophy|victory/i, 'a gold championship trophy raised under confetti'],
];

export function visualFor(text: string): string {
  const hits = VISUALS.filter(([re]) => re.test(text)).slice(0, 2).map(([, v]) => v);
  return hits.length ? hits.join(', with ') : `a cinematic scene that captures the feeling of the lyric`;
}

export function buildPrompt(o: { lyric: string; mood: string; withAvatar: boolean; avatar: string; letterWord?: string; city?: string; composition?: string; extra?: string; idea?: string }): string {
  const mood = MOODS[o.mood] ?? { grade: `${o.mood} color grade`, light: '' };
  const id = o.withAvatar
    ? `The main character is the person in the reference photos. Preserve their exact facial identity, hairstyle and skin tone. ${o.avatar ? o.avatar + ' ' : ''}`
    : '';
  const scene = o.idea
    ? `Scene: ${o.idea.replace(/\.$/, '')}.${o.letterWord ? ` It embodies the word "${o.letterWord}".` : ''}`
    : o.letterWord
      ? `A scene that visually embodies the word "${o.letterWord}": ${visualFor(o.letterWord + ' ' + o.lyric)}, inspired by the lyric "${o.lyric}".`
      : `Scene: ${visualFor(o.lyric)}, inspired by the lyric "${o.lyric}".`;
  return [id, mood.light, scene, o.extra || '',
    `Cinematic photoreal music video film still, wide 16:9, ${o.composition ?? 'subject placed on the right two-thirds leaving clean space on the left third for titles'}, 35mm anamorphic lens, shallow depth of field, natural skin texture, ${mood.grade}${o.city ? `, ${o.city}` : ''}.`,
    'No text, no letters, no captions, no logos, no watermarks.'].filter(Boolean).join(' ').replace(/\s+/g, ' ');
}

