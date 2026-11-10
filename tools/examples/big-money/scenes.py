# Big Money — 40 concept images. Lyric lines are mapped onto these after planning (map.json).
import json
ID = ("The main character is the man in the reference photos. Preserve his exact facial identity from them: face shape, blue-grey eyes, nose, brow, smile, "
      "short dark textured hair with faded sides, salt-and-pepper stubble to short goatee, olive skin; he wears a heavy gold Cuban link chain. ")
LOOK = (" PHOTOREALISM: this must look like a real photograph, indistinguishable from a frame of a big-budget hip-hop music video shot on an ARRI Alexa 35 with Cooke anamorphic lenses — "
        "true-to-life skin with pores, fine lines and natural imperfections, real fabric texture, physically accurate light and shadows, natural lens flare and film grain, true color. "
        "Not CGI, not 3D render, not illustration, no airbrushed or plastic skin, no HDR halo look, no over-sharpening. "
        "Gangster rap video energy: low camera angle, confident body language, hard contrast night light or golden-hour sun. "
        "Composed for multilayer parallax animation: the man stands at mid-depth on the left or right third, his whole silhouette clearly separated from the background with open space around him; "
        "a deep background far behind; one out-of-focus foreground element close to the lens at a frame edge; nothing important within the outer 10% of the frame. "
        "Any other people are adults. Plain unbranded clothes. No text, no letters, no numbers, no logos, no signs, no banners, no lettering on clothing, no watermarks.")
C = {
'C01': (1, 'He swaggers toward camera down the middle of a wet downtown street at night, steam rising from manholes, warm streetlights and neon reflections, confident grin, black tee and gold chain, low angle.'),
'C02': (1, 'Low-angle hero shot: he stands on a rooftop edge at golden sunset pointing straight at camera, city skyline and a big lake behind him, wind in his shirt.'),
'C03': (1, 'He leans on the door of a glossy black vintage 1960s convertible parked outside a busy brick venue at night, adults waiting in line behind velvet ropes, photo flashes popping, cool smile.'),
'C04': (0, 'Extreme close-up of hands slapping a bass guitar on stage, strings blurred with motion, warm amber stage light, smoke, gold rings on fingers.'),
'C05': (0, 'Four-piece brass section of adult horn players blasting trumpets and trombones in a packed warehouse party, cheeks puffed, gold light bursting through haze.'),
'C06': (1, 'He struts confidently through the middle of a crowded nightclub dance floor, adults cheering and dancing around him, paper cash fluttering through the air, magenta and green lights.'),
'C07': (1, 'He laughs at the head of a long banquet table with his crew of adult friends, huge platters of food, glasses raised, warm candle and string lights, everyone eating.'),
'C08': (1, 'Medium close-up: he fans a thick stack of cash toward the camera with a sly grin, gold rings and chain catching the light, dark lounge behind him, bills slightly out of focus so no print is readable.'),
'C09': (1, 'He performs on a big stage with a microphone, crowd of adults with hands up in front of him, gold confetti exploding, strobe beams.'),
'C10': (1, 'He rises out of a turquoise rooftop infinity pool at sunset, water streaming off him, sunglasses, skyline behind, playful smirk.'),
'C11': (1, 'He stands at the bow of a speedboat cutting across a big summer lake, adult friends partying behind him, spray and sun flare, skyline far away.'),
'C12': (1, 'Years earlier: he sits alone at a small kitchen table at night counting a few crumpled bills under a single bare bulb, hungry determined look, cold blue shadows.'),
'C13': (1, 'He sleeps peacefully in a luxury penthouse bed at night while the city glows through floor-to-ceiling glass; a laptop on the nightstand glows with abstract charts.'),
'C14': (1, 'He stands on the end of a long pier at night as a thunderstorm erupts over the lake, forked lightning behind him, rain, he raps into the wind.'),
'C15': (1, 'In a sleek glass-walled office at night he leans over a desk of glowing abstract chart screens, sleeves pushed up, flexing a forearm, intense focus.'),
'C16': (1, 'He is a chef in a steamy restaurant kitchen tossing pasta in a pan that bursts into flame, red sauce, giving a chef\'s kiss with his other hand, grinning.'),
'C17': (1, 'At sunset he sets a brick on a half-built brick building, trowel in hand, scaffolding and warm dust, proud look.'),
'C18': (1, 'He drives a vintage muscle car at night down a cracked road full of potholes, dashboard warning light glowing amber, confident hand on the wheel, city lights ahead.'),
'C19': (1, 'Stylized: he stands with eyes closed and arms open while hundreds of gold coins swirl around him in a spiral, magnetic, glowing dark background.'),
'C20': (0, 'A trumpet player kicks open big double doors and blasts his horn as golden light floods out behind him, smoke, dramatic backlight.'),
'C21': (1, 'In his modern office at night his business partner, a professional woman in a blazer, stands in the doorway with arms crossed, laughing and shaking her head; he leans back at his desk with his phone face down, grinning.'),
'C22': (0, 'A phone lying face down on a black marble table next to an espresso and gold watch, screen glow leaking around its edges, moody light.'),
'C23': (1, 'He walks at night past a row of small glowing storefronts he owns, warm windows with no signs, wide street, proud stride.'),
'C24': (1, 'He stands beneath a huge old oak tree whose branches are wrapped in glowing string lights spreading across the night sky, summer park.'),
'C25': (1, 'He sits in a dark warehouse office with an old worn leather wallet in his hand, looking at it with a small smile, gold lamp light, stacks of boxes behind.'),
'C26': (1, 'Summer lakefront festival at dusk: he walks through the crowd of adults past food stands and a lit Ferris wheel, lake breeze, string lights.'),
'C27': (1, 'Winter night: he stands in a heavy coat with friends around a fire barrel in falling snow, laughing, warm firelight on faces.'),
'C28': (1, 'Bridge: he stands alone center stage in one white spotlight, palm raised to the ceiling, dark crowd silhouettes, haze beams.'),
'C29': (0, 'A packed crowd of adults jumping with hands up in a dark venue, gold confetti, backlit beams, motion blur, pure energy.'),
'C30': (1, 'Mob-movie style: he sits in a leather chair in a smoky cigar lounge wearing a pinstripe suit, signing a contract with a gold pen, low warm light.'),
'C31': (0, 'A towering stack of concert speakers in a warehouse, dust jumping off the speaker cones, bass shockwave in the haze, strobe light.'),
'C32': (1, 'He stands alone in a boxing ring in a sharp suit with both arms raised, empty dark arena, single overhead light, victorious.'),
'C33': (1, 'At dawn he stands on the center line of a brand-new empty highway with freshly painted lanes stretching to the horizon, arms crossed.'),
'C34': (1, 'He opens the big front doors of a grand modern mansion at night to welcome arriving adult guests, warm light spilling out, big smile.'),
'C35': (1, 'He raises a crystal glass in a toast at a rooftop party at night, fireworks bursting over the lake behind him, adult friends cheering.'),
'C36': (1, 'Night drive from the passenger seat: he drives fast, city lights streaking past, the rearview mirror folded away, eyes on the road ahead.'),
'C37': (1, 'Back view: he walks away down a glistening street at night, dripping wet, gold streetlight halos, steam, confident stride.'),
'C38': (1, 'He sits on the hood of the black vintage car at a lakefront overlook at sunset, crew of adult friends around, laughing, summer haze.'),
'C39': (1, 'Tight portrait: he looks into camera with a sly grin in a neon-lit club booth, magenta and green light, sunglasses pushed up on his head.'),
'C40': (1, 'He dances the money walk at the front of a line of adult friends strutting in sync down a sunny summer street, block party, everyone smiling.'),
}
REFS = ['/home/claude/bm/refs/n2.jpg', '/home/claude/bm/refs/n4.jpg', '/home/claude/bm/refs/n1.jpg', '/home/claude/bm/refs/r1.jpg', '/home/claude/bm/refs/r3_ff.jpg']
MKE = '/home/claude/bm/mke/'
LOC = {'C01': 'Milwaukee_Third_Ward_street_1', 'C02': 'Milwaukee_skyline_night_5', 'C03': 'Milwaukee_Third_Ward_street_3', 'C10': 'Milwaukee_skyline_night_5',
       'C11': 'Milwaukee_skyline_night_5', 'C13': 'Milwaukee_skyline_night_3', 'C14': 'Milwaukee_skyline_night_1', 'C15': 'Milwaukee_skyline_night_0',
       'C23': 'Milwaukee_Third_Ward_street_2', 'C26': 'Milwaukee_skyline_night_0', 'C27': 'Milwaukee_Third_Ward_street_3', 'C33': 'Hoan_Bridge_Milwaukee_2',
       'C35': 'Milwaukee_skyline_night_1', 'C36': 'Hoan_Bridge_Milwaukee_3', 'C37': 'Milwaukee_Third_Ward_street_1', 'C38': 'Milwaukee_skyline_night_0',
       'C40': 'Milwaukee_Third_Ward_street_2', 'C12': None}
LOCTXT = (' LOCATION: the real city in the LAST reference image — match its actual skyline and architecture exactly (its tallest lakefront towers, '
          'the white winged museum roof on the lake, the yellow-arched highway bridge, the old brick warehouse streets), adapted to this scene and time of day. '
          'Do not invent a generic skyline. All signs, storefronts and building tops are blank — no names, no logos on any building. '
          'He is lit by the same light as the location and casts real shadows and reflections in it. ')
def P(a, idea, k=None):
    loc = LOCTXT if LOC.get(k) else ''
    if not a: return 'Create a new photoreal scene. SCENE: ' + idea + loc + LOOK
    return ('Create a completely NEW cinematic wide shot (not a portrait, not a close-up, do not copy any reference photo\'s pose, framing, clothing or background). '
            'SCENE: ' + idea + loc + ' CAMERA: medium-wide or wide shot, the man fills about 45-60% of the frame height, the full location is visible around him. '
            'IDENTITY: use the first reference photos only for the man\'s face' + (' — the last reference image is the location, not a person' if loc else '') + '. ' + ID + LOOK)
jobs = [dict(name=k, prompt=P(a, idea, k), refs=(REFS if a else []) + ([MKE + LOC[k] + '.jpg'] if LOC.get(k) else []), clean=True) for k, (a, idea) in C.items()]
FG = {
 'FG_cash':   'A dozen paper banknotes tumbling through the air at different angles, motion blur, isolated on a transparent background, no readable print or numbers.',
 'FG_smoke':  'Wisps of thick white cigar smoke curling and drifting, soft and translucent, isolated on a transparent background.',
 'FG_confetti': 'Hundreds of shiny gold foil confetti pieces falling, some blurred, isolated on a transparent background.',
 'FG_champagne': 'A burst of champagne spray and droplets exploding diagonally, sparkling backlit, isolated on a transparent background.',
 'FG_chainfence': 'A section of chain-link fence, out of focus, filling the frame, isolated on a transparent background.',
 'FG_sparks': 'Bright golden sparks and embers flying upward with streaks, isolated on a transparent background.',
 'FG_rain': 'Heavy rain streaks and droplets catching backlight, isolated on a transparent background.',
 'FG_bokeh': 'Large soft out-of-focus golden and magenta bokeh light circles, isolated on a transparent background.',
}
jobs += [dict(name=k, prompt=v + ' No text.', sprite=True) for k, v in FG.items()]
json.dump(jobs, open('jobs.json', 'w'), indent=1); print(len(jobs), 'jobs')
