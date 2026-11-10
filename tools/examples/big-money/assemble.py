# Big Money: concept plates (C##) -> per-scene files (S##) for build.mjs + layers.py, plus fx/fg maps.
import json, os
from PIL import Image
first = json.load(open('first.json'))            # concept -> first scene id using it
os.makedirs('imgs', exist_ok=True); os.makedirs('splates', exist_ok=True)
for c, s in first.items():
    hero, bg = f'plates/{c}.png', f'plates/{c}_bg.png'
    if not os.path.exists(hero): print('MISSING', c); continue
    im = Image.open(hero).convert('RGB'); im.resize((1920, 1080), Image.LANCZOS).save(f'imgs/{s}.jpg', quality=93)
    for src, dst in ((hero, f'splates/{s}.png'), (bg, f'splates/{s}_bg.png')):
        if os.path.exists(src) and not os.path.exists(dst): os.symlink(os.path.abspath(src), dst)
FX = {'C14': ['rain'], 'C37': ['rain'], 'C27': ['snow', 'embers'], 'C35': ['sparks'], 'C09': ['sparks'], 'C20': ['rays'], 'C02': ['flare'],
      'C10': ['flare'], 'C33': ['rays'], 'C28': ['rays'], 'C19': ['sparks'], 'C26': ['flare'], 'C38': ['flare'], 'C12': ['dust']}
FG = {'C06': 'FG_cash', 'C08': 'FG_cash', 'C40': 'FG_cash', 'C07': 'FG_bokeh', 'C09': 'FG_confetti', 'C29': 'FG_confetti', 'C30': 'FG_smoke',
      'C35': 'FG_champagne', 'C14': 'FG_rain', 'C37': 'FG_rain', 'C27': 'FG_sparks', 'C05': 'FG_bokeh', 'C16': 'FG_sparks', 'C32': 'FG_smoke',
      'C20': 'FG_smoke', 'C39': 'FG_bokeh', 'C31': 'FG_sparks', 'C11': 'FG_champagne', 'C03': 'FG_bokeh', 'C24': 'FG_bokeh'}
json.dump({first[c]: v for c, v in FX.items() if c in first}, open('fx.json', 'w'))
json.dump({first[c]: v for c, v in FG.items() if c in first}, open('fg.json', 'w'))
print(len(os.listdir('imgs')), 'scene images')
