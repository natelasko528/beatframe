#!/usr/bin/env python3
"""Checkpointed parallel render: split the song into frame-exact chunks, render N at a time, keep every validated chunk,
then join them without re-encoding and add the audio once. Re-running after a crash only renders what's missing.

    python3 tools/render_chunks.py project.beatframe.json --audio song.mp3 --out video.mp4 [--assets dir] [--chunks 12] [--jobs 2] [--res 1080]
"""
import argparse, json, os, subprocess, sys, hashlib, time
from concurrent.futures import ThreadPoolExecutor

ap = argparse.ArgumentParser()
ap.add_argument('project'); ap.add_argument('--audio', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--assets'); ap.add_argument('--chunks', type=int, default=12); ap.add_argument('--jobs', type=int, default=2); ap.add_argument('--res', default='1080')
a = ap.parse_args()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = json.load(open(a.project)); fps = p.get('fps', 30); total = round(p['analysis']['dur'] * fps)

# cache key: project + engine sources + layer files, so stale chunks are never reused after a change
h = hashlib.sha1(open(a.project, 'rb').read())
for d in [os.path.join(ROOT, 'src', 'engine')] + ([a.assets] if a.assets else []):
    for f in sorted(os.listdir(d)): h.update(f.encode()); h.update(str(os.path.getmtime(os.path.join(d, f))).encode())
key = h.hexdigest()[:10]
work = os.path.splitext(os.path.abspath(a.out))[0] + f'.chunks-{key}'; os.makedirs(work, exist_ok=True)
per = -(-total // a.chunks); ranges = [(i * per, min(total, (i + 1) * per)) for i in range(a.chunks) if i * per < total]

def frames(f):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets,width', '-of', 'csv=p=0', f], capture_output=True, text=True)
    try: w, n = r.stdout.strip().split(','); return int(n), int(w)
    except ValueError: return 0, 0

def render(i):
    f0, f1 = ranges[i]; seg = f'{work}/c{i:02d}.mp4'; ok = seg + '.ok'
    if os.path.exists(ok): return f'chunk {i}: cached'
    cmd = ['node', os.path.join(ROOT, 'cli', 'beatframe.mjs'), 'render', a.project, '--out', seg, '--res', a.res, '--from', repr(f0 / fps), '--to', repr(f1 / fps), '--workers', '1']
    if a.assets: cmd += ['--assets', a.assets]
    t = time.time(); r = subprocess.run(cmd, capture_output=True, text=True)
    n, w = frames(seg)
    if r.returncode or n != f1 - f0: raise SystemExit(f'chunk {i} failed: {n}/{f1 - f0} frames\n{r.stderr[-800:]}')
    open(ok, 'w').write(f'{n} {w}'); return f'chunk {i}: {n} frames in {time.time() - t:.0f}s'

with ThreadPoolExecutor(a.jobs) as ex:
    for msg in ex.map(render, range(len(ranges))): print(msg, flush=True)
lst = f'{work}/list.txt'; open(lst, 'w').write(''.join(f"file '{work}/c{i:02d}.mp4'\n" for i in range(len(ranges))))
subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-i', a.audio, '-map', '0:v', '-map', '1:a',
                '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-shortest', '-movflags', '+faststart', a.out], check=True)
n, w = frames(a.out); print(f'Done: {a.out}  {n}/{total} frames, width {w}'); sys.exit(0 if n == total else 1)
