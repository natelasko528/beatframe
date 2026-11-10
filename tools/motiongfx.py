#!/usr/bin/env python3
"""Switch on the motion-graphics pass for a built project.

    python3 tools/motiongfx.py project.beatframe.json --assets layers/ [--fg fg.json --sprites plates/] [--hook 2 --verse 4]

- lyrics.slam: hook words slam in on their beat, (CALL-OUTS) become stamped tags, bass-driven shockwaves / light streaks / drop speed lines.
- Foreground sprites: fg.json maps scene id -> sprite name (e.g. {"S07": "FG_cash"}); the transparent PNGs are copied into the
  assets dir and registered, so they glide in front of the lens in those scenes.
- Then runs tools/beatcut.py: beat-grid cuts with camera angles and drum-matched transitions.
"""
import json, os, shutil, subprocess, sys
a = sys.argv[1:]; P = a[0]; opt = lambda k, d=None: a[a.index('--' + k) + 1] if '--' + k in a else d
p = json.load(open(P)); assets = opt('assets'); p['style']['lyrics']['slam'] = True
fg = json.load(open(opt('fg'))) if opt('fg') else {}
if fg:
    sp = opt('sprites'); os.makedirs(assets, exist_ok=True)
    p['assets'] = [x for x in p['assets'] if not x['id'].startswith('FG_')]
    for name in sorted(set(fg.values())):
        shutil.copy(f'{sp}/{name}.png', f'{assets}/{name}.png')
        p['assets'].append({'id': name, 'name': name, 'kind': 'layer', 'url': f'file:{name}.png'})
    for s in p['scenes']:
        if s['id'] in fg: s['fg'] = fg[s['id']]
json.dump(p, open(P, 'w'))
print('slam on; foreground sprites on', len([s for s in p['scenes'] if s.get('fg')]), 'scenes')
extra = sum([['--' + k, opt(k)] for k in ('hook', 'verse', 'bridge', 'outro') if opt(k)], [])
subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'beatcut.py'), P] + extra, check=True)
