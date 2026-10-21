#!/usr/bin/env python3
"""Split each scene still into 3 depth layers (far / mid / near) for smooth 2.5D parallax.

    python3 tools/layers.py project.beatframe.json outdir [--only S01,S05]

For every image asset with a depth map (`<id>~depth`) it writes:
  <id>_L0.webp  far layer, opaque; whatever sits in front of it is inpainted so nothing is missing when layers slide
  <id>_L1.webp  mid layer, soft-edged alpha; the near layer's footprint is inpainted
  <id>_L2.webp  near layer (usually the artist), crisp alpha
and adds assets `<id>~L0..2` (url file:<name>) to the project, so `beatframe render --assets outdir` loads them.
The renderer moves each layer as a rigid plane (its own speed + zoom), so nothing inside a layer warps.
"""
import base64, io, json, sys, os
from concurrent.futures import ProcessPoolExecutor
import numpy as np, cv2
from PIL import Image
from rembg import new_session, remove
_S = None
def SESSION():
    global _S
    if _S is None: _S = new_session('isnet-general-use')
    return _S


def decode(url):
    return Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1])))


def clean(mask, k, min_frac=0.004):
    m = mask.astype(np.uint8) * 255
    ker = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, ker); m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, ker)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros_like(m); area = m.size
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= area * min_frac: keep[lab == i] = 255
    # fill holes inside kept blobs
    inv = cv2.bitwise_not(keep); n2, lab2, st2, _ = cv2.connectedComponentsWithStats(inv, 4)
    for i in range(1, n2):
        x, y, w, h, a = st2[i]
        if x > 0 and y > 0 and x + w < m.shape[1] and y + h < m.shape[0] and a < area * 0.01: keep[lab2 == i] = 255
    return keep


def inpaint(img, mask, grow):
    """Fill `mask` (grown by `grow` px) from its surroundings. Done at half res, pasted back only inside the mask."""
    m = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (grow * 2 + 1, grow * 2 + 1)))
    h, w = m.shape; s = cv2.resize(img, (w // 2, h // 2), interpolation=cv2.INTER_AREA); ms = cv2.resize(m, (w // 2, h // 2), interpolation=cv2.INTER_NEAREST)
    f = cv2.inpaint(s, ms, 7, cv2.INPAINT_TELEA); f = cv2.resize(f, (w, h), interpolation=cv2.INTER_CUBIC)
    f = cv2.GaussianBlur(f, (0, 0), 3)
    a = cv2.GaussianBlur(m.astype(np.float32) / 255, (0, 0), 4)[..., None]
    return (img * (1 - a) + f * a).astype(np.uint8)


def feather(mask, sigma, erode=0):
    m = mask
    if erode: m = cv2.erode(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (erode * 2 + 1, erode * 2 + 1)))
    return np.clip(cv2.GaussianBlur(m.astype(np.float32), (0, 0), sigma), 0, 255).astype(np.uint8)


def split(job):
    sid, img_url, dep_url, out = job
    img = np.array(decode(img_url).convert('RGB'))[..., ::-1].copy()      # BGR for cv2
    h, w = img.shape[:2]
    d = np.array(decode(dep_url).convert('L').resize((w, h), Image.BICUBIC)).astype(np.float32) / 255
    d = cv2.bilateralFilter(cv2.GaussianBlur(d, (0, 0), 2), 9, 0.08, 9)
    # near layer = the subject (artist, or the symbol object), from a salient-object matte, so a person is never split across layers
    matte = np.array(remove(Image.fromarray(img[..., ::-1]), session=SESSION(), only_mask=True).resize((w, h)))
    near = clean(matte > 128, 7, 0.01)
    if near.mean() / 255 < 0.02: near = clean(d > np.quantile(d, 0.85), 15)       # nothing salient: nearest 15% by depth
    a2 = np.maximum(np.minimum(matte, cv2.dilate(near, np.ones((9, 9), np.uint8))), feather(near, 1.5, erode=2))   # solid body, soft hair            # keep the soft matte (hair), drop stray specks
    # far / mid split of everything else by depth (2-means on the non-subject pixels)
    rest = d[(near == 0)][::7].reshape(-1, 1).astype(np.float32)
    _, _, cen = cv2.kmeans(rest, 2, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 1e-3), 3, cv2.KMEANS_PP_CENTERS)
    t1 = float(cen.mean()); mid = clean(d > t1, 21) | near
    # mid layer: colours with the near footprint filled in; soft edge so ground planes don't show a seam
    midc = inpaint(img, near, 14); a1 = feather(mid, 6)
    # far layer: everything in front filled in
    far = inpaint(img, mid, 18)
    rgb = lambda x: Image.fromarray(x[..., ::-1].copy())
    rgb(far).save(f'{out}/{sid}_L0.webp', quality=90)
    Image.fromarray(np.dstack([midc[..., ::-1], a1])).save(f'{out}/{sid}_L1.webp', quality=90)
    Image.fromarray(np.dstack([img[..., ::-1], a2])).save(f'{out}/{sid}_L2.webp', quality=92)
    ys, xs = np.nonzero(near)
    # focus = the subject's head (top ~15% of its silhouette): camera and subject zoom pivot here, so the face stays put while the frame pushes in
    if len(ys):
        top, bot = np.quantile(ys, 0.01), np.quantile(ys, 0.99); fy = top + 0.15 * (bot - top); sel = ys < top + 0.3 * (bot - top)
        anchor = [round(float(np.median(xs[sel]) / w), 3), round(float(fy / h), 3)]
    else: anchor = [0.5, 0.4]
    return sid, float((near > 127).mean()), float((mid > 127).mean()), anchor


if __name__ == '__main__':
    proj, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
    only = set(sys.argv[sys.argv.index('--only') + 1].split(',')) if '--only' in sys.argv else None
    p = json.load(open(proj)); A = {a['id']: a for a in p['assets']}
    jobs = [(a['id'], a['url'], A[a['id'] + '~depth']['url'], out) for a in p['assets']
            if a['kind'] == 'image' and a['id'] + '~depth' in A and (not only or a['id'] in only)]
    with ProcessPoolExecutor(2) as ex:
        anchors = {}
        for sid, n, m, an in ex.map(split, jobs): anchors[sid] = an; print(f'{sid}: subject {n:.0%}  mid+subject {m:.0%}  anchor {an}', flush=True)
    if not only:
        p['assets'] = [a for a in p['assets'] if '~L' not in a['id']]
        for sid, *_ in jobs:
            for i in range(3): p['assets'].append({'id': f'{sid}~L{i}', 'name': f'{sid}_L{i}', 'kind': 'layer', 'url': f'file:{sid}_L{i}.webp'})
        for sc in p['scenes']:
            if sc['id'] in anchors: sc['anchor'] = anchors[sc['id']]
        json.dump(p, open(proj, 'w')); print('project updated:', proj)
