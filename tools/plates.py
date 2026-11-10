#!/usr/bin/env python3
"""Shoot 'plates' for layered parallax with OpenAI GPT Image 2.6 (key in ~/.secrets/openai, never printed).

    python3 tools/plates.py jobs.json outdir [--threads 3] [--size 3840x2160] [--quality high] [--only C01,C02]

jobs.json: [{"name": "C01", "prompt": "...", "refs": ["face1.jpg", ...], "clean": true}, ...]
           [{"name": "FG_cash", "prompt": "...", "sprite": true}]  -> transparent foreground element (1536x1024)

For every scene it writes:
  outdir/<name>.png        hero plate (the full scene, 4K)            — gpt-image-2.6-sunburst edits with identity refs
  outdir/<name>_bg.png     clean background plate (subject removed)   — edit of the hero plate, so it lines up
Sprites: outdir/<name>.png with a real alpha channel (gpt-image-2.6-flare, background transparent).
Skips files that already exist, so re-running only fills gaps. Prints token usage for an honest cost tally.
"""
import base64, io, json, os, subprocess, sys, time, tempfile
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

KEY = open(os.path.expanduser('~/.secrets/openai')).read().strip()
args = sys.argv[1:]; opt = lambda k, d: args[args.index('--' + k) + 1] if '--' + k in args else d
JOBS, OUT = args[0], args[1]; os.makedirs(OUT, exist_ok=True)
SIZE, Q, TH = opt('size', '3840x2160'), opt('quality', 'high'), int(opt('threads', 3))
ONLY = set(opt('only', '').split(',')) - {''}
USAGE = {'in': 0, 'out': 0}

CLEAN = ("Remove the main man completely from this image and rebuild exactly what was behind him — continue the walls, floor, street, crowd, "
         "lights and background naturally as if he was never there. Keep everything else identical: same framing, same camera, same lighting, "
         "same colors, same objects in the same places. Photoreal. No text.")


def call(endpoint, fields, files=(), tries=3):
    for t in range(tries):
        cmd = ['curl', '-sS', '--max-time', '600', f'https://api.openai.com/v1/images/{endpoint}', '-H', f'Authorization: Bearer {KEY}']
        if endpoint == 'generations':
            cmd += ['-H', 'Content-Type: application/json', '-d', json.dumps(fields)]
        else:
            for k, v in fields.items(): cmd += ['-F', f'{k}={v}']
            for f in files: cmd += ['-F', f'image[]=@{f}']
        out = subprocess.run(cmd, capture_output=True, text=True).stdout
        try: d = json.loads(out)
        except Exception: d = {'error': {'message': out[:200]}}
        if 'error' not in d:
            u = d.get('usage') or {}; USAGE['in'] += u.get('input_tokens', 0); USAGE['out'] += u.get('output_tokens', 0)
            return Image.open(io.BytesIO(base64.b64decode(d['data'][0]['b64_json'])))
        msg = d['error'].get('message', '')
        if 'safety' in msg.lower() or 'invalid' in msg.lower(): raise RuntimeError(msg[:300])
        time.sleep(5 * (t + 1))
    raise RuntimeError(msg[:300])


_SES = None
def subject_mask(H):
    """Where the person is (grown generously), as uint8 0/255 at full size."""
    global _SES
    import numpy as np, cv2
    from rembg import new_session, remove
    if _SES is None: _SES = new_session('isnet-general-use')
    small = H.resize((1536, round(1536 * H.height / H.width)))
    m = np.array(remove(small, session=_SES, only_mask=True).resize(H.size))
    m = (m > 100).astype(np.uint8) * 255
    return cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (61, 61)))


def call_mask(prompt, img, mask, tries=3):
    for t in range(tries):
        out = subprocess.run(['curl', '-sS', '--max-time', '600', 'https://api.openai.com/v1/images/edits', '-H', f'Authorization: Bearer {KEY}',
                              '-F', 'model=gpt-image-2.6-sunburst', '-F', f'prompt={prompt}', '-F', f'size={SIZE}', '-F', f'quality={Q}', '-F', 'n=1',
                              '-F', f'image[]=@{img}', '-F', f'mask=@{mask}'], capture_output=True, text=True).stdout
        try: d = json.loads(out)
        except Exception: d = {'error': {'message': out[:200]}}
        if 'error' not in d:
            u = d.get('usage') or {}; USAGE['in'] += u.get('input_tokens', 0); USAGE['out'] += u.get('output_tokens', 0)
            return Image.open(io.BytesIO(base64.b64decode(d['data'][0]['b64_json'])))
        time.sleep(5 * (t + 1))
    raise RuntimeError(d['error'].get('message', '')[:300])


def align_clean(H, C, mask):
    """The model may reframe slightly. Warp the clean plate onto the hero with a homography fitted on the background,
    then keep the hero's own pixels everywhere except the subject area, so every layer lines up exactly."""
    import numpy as np, cv2
    h = np.array(H)[..., ::-1]; c = np.array(C.resize(H.size, Image.LANCZOS))[..., ::-1]
    g1, g2 = cv2.cvtColor(h, cv2.COLOR_BGR2GRAY), cv2.cvtColor(c, cv2.COLOR_BGR2GRAY)
    s = 1536 / g1.shape[1]; a1, a2 = cv2.resize(g1, None, fx=s, fy=s), cv2.resize(g2, None, fx=s, fy=s)
    keep = cv2.resize(255 - mask, (a1.shape[1], a1.shape[0]), interpolation=cv2.INTER_NEAREST)
    sift = cv2.SIFT_create(4000); k1, d1 = sift.detectAndCompute(a1, keep); k2, d2 = sift.detectAndCompute(a2, None)
    ok = False
    if d1 is not None and d2 is not None and len(k1) > 30 and len(k2) > 30:
        m = [x for x, y in cv2.BFMatcher().knnMatch(d1, d2, k=2) if x.distance < 0.75 * y.distance]
        if len(m) > 40:
            src = np.float32([k2[x.trainIdx].pt for x in m]) / s; dst = np.float32([k1[x.queryIdx].pt for x in m]) / s
            M, inl = cv2.findHomography(src, dst, cv2.RANSAC, 4.0)
            if M is not None and inl.sum() > 30: c = cv2.warpPerspective(c, M, (h.shape[1], h.shape[0]), borderMode=cv2.BORDER_REFLECT); ok = True
    a = cv2.GaussianBlur(mask.astype(np.float32) / 255, (0, 0), 12)[..., None]
    out = (h * (1 - a) + c * a).astype(np.uint8)
    print('   clean plate aligned' if ok else '   clean plate: alignment fallback (unwarped)', flush=True)
    return Image.fromarray(out[..., ::-1])


def shoot(j):
    n = j['name']; hero = f'{OUT}/{n}.png'; t0 = time.time()
    try:
        if j.get('sprite'):
            if not os.path.exists(hero):
                call('generations', {'model': 'gpt-image-2.6-flare', 'prompt': j['prompt'], 'size': '1536x1024', 'quality': 'medium',
                                     'background': 'transparent', 'output_format': 'png', 'n': 1}).save(hero)
            return f'{n}: sprite ok'
        if not os.path.exists(hero):
            fields = {'model': 'gpt-image-2.6-sunburst', 'prompt': j['prompt'], 'size': SIZE, 'quality': Q, 'n': 1}
            img = call('edits', fields, j.get('refs') or []) if j.get('refs') else call('generations', {**fields, 'model': 'gpt-image-2.6-flare'})
            img.convert('RGB').save(hero)
        bg = f'{OUT}/{n}_bg.png'
        if j.get('clean', True) and not os.path.exists(bg):
            H = Image.open(hero).convert('RGB'); mask = subject_mask(H)
            with tempfile.NamedTemporaryFile(suffix='.png') as tf, tempfile.NamedTemporaryFile(suffix='.png') as tm:
                H.save(tf.name)
                m = Image.new('RGBA', H.size, (0, 0, 0, 255)); m.putalpha(Image.fromarray(255 - mask)); m.save(tm.name)   # transparent = area to rebuild
                img = call_mask(CLEAN, tf.name, tm.name)
            align_clean(H, img.convert('RGB'), mask).save(bg)
        return f'{n}: ok {time.time() - t0:.0f}s'
    except Exception as e:
        return f'{n}: FAILED {e}'


jobs = [j for j in json.load(open(JOBS)) if not ONLY or j['name'] in ONLY]
with ThreadPoolExecutor(TH) as ex:
    for r in ex.map(shoot, jobs): print(r, flush=True)
print(f"tokens this run: input {USAGE['in']}, output {USAGE['out']}  "
      f"(~${USAGE['in'] * 8e-6 + USAGE['out'] * 30e-6:.2f} at $8/M image-in, $30/M out; text-in billed less)")
