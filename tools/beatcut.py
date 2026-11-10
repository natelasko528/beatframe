#!/usr/bin/env python3
"""Motion-graphics edit pass: turn one-shot-per-lyric-line into a beat-cut music-video edit.

    python3 tools/beatcut.py project.beatframe.json [--hook 2] [--verse 4] [--bridge 4] [--outro 4]

- Splits every scene shot on the beat grid: every N beats per section (hooks cut fastest).
- Gives each cut a camera angle (0 wide, 1 medium, 2 close, 3 crane, 4 pull-back) so one image plays as several setups,
  never repeating the previous angle; repeated choruses start at a different angle.
- Gives each cut a transition that matches the drum on that beat: snare -> whip pan, kick -> zoom punch,
  section start / drop -> RGB glitch, otherwise a hard cut.
Idempotent: re-running starts again from the original one-per-line shots (kept in project['shotsBase']).
"""
import json, sys, bisect

args = sys.argv[1:]; P = args[0]
opt = lambda k, d: float(args[args.index('--' + k) + 1]) if '--' + k in args else d
EVERY = {'hook': opt('hook', 2), 'chant': opt('hook', 2), 'verse': opt('verse', 4), 'bridge': opt('bridge', 4), 'outro': opt('outro', 4), 'intro': opt('verse', 4)}
p = json.load(open(P)); A = p['analysis']
base = p.get('shotsBase') or p['shots']; p['shotsBase'] = base
beats, kicks, snares = A['beats'], A.get('kicks', []), A.get('snares', [])
secs = p['sections']; drops = p.get('drops', [])

def sec_at(t):
    s = secs[0][0]
    for name, st in secs:
        if t >= st - 1e-3: s = name
    return s

def near(arr, t, tol=0.07):
    i = bisect.bisect_left(arr, t)
    return any(0 <= j < len(arr) and abs(arr[j] - t) <= tol for j in (i - 1, i))

out = []; seen = {}; prev_angle = -1
for sh in base:
    if sh.get('kind') in ('open', 'end', 'title') or not sh.get('img'):
        out.append(dict(sh)); continue
    n = EVERY.get(sec_at(sh['from'] + 0.05), 4)
    # beat-grid cut points strictly inside the shot, every n beats from its first beat
    i0 = bisect.bisect_left(beats, sh['from'] - 0.05)
    cuts = [sh['from']] + [beats[j] for j in range(i0 + int(n), len(beats), int(n)) if sh['from'] + 0.45 < beats[j] < sh['to'] - 0.45] + [sh['to']]
    occ = seen.get(sh['img'], 0); seen[sh['img']] = occ + 1
    for k in range(len(cuts) - 1):
        a, b = cuts[k], cuts[k + 1]; f = (a - sh['from']) / max(0.01, sh['to'] - sh['from']); g = (b - sh['from']) / max(0.01, sh['to'] - sh['from'])
        x = dict(sh, **{'from': round(a, 3), 'to': round(b, 3)})
        for key in ('z', 'x', 'y'):
            v0, v1 = sh[key + '0'], sh[key + '1']; x[key + '0'] = round(v0 + (v1 - v0) * f, 4); x[key + '1'] = round(v0 + (v1 - v0) * g, 4)
        if k: x.pop('drop', None); x.pop('flash', None); x.pop('caption', None)
        ang = (occ * 2 + k * 2 + (k // 2)) % 5
        if ang == prev_angle: ang = (ang + 1) % 5
        x['angle'] = ang; prev_angle = ang
        boundary = any(abs(s[1] - a) < 0.3 for s in secs) or any(abs(d - a) < 0.3 for d in drops)
        x['trans'] = 'glitch' if boundary else 'whip' if near(snares, a) else 'zoom' if near(kicks, a) else 'cut'
        out.append(x)
p['shots'] = out
json.dump(p, open(P, 'w'))
from collections import Counter
print(f"{len(base)} line shots -> {len(out)} cuts | angles {dict(Counter(s.get('angle') for s in out))} | transitions {dict(Counter(s.get('trans') for s in out))}")
