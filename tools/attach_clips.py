#!/usr/bin/env python3
"""Smooth clips to 30 fps, upscale to 1080p, encode VP9 (decodes in every browser), and reference them from the project.
Usage: attach_clips.py project.beatframe.json clips_dir out_project.json clipfiles_dir"""
import sys, json, glob, os, subprocess
pj, src, out, dst = sys.argv[1:5]; os.makedirs(dst, exist_ok=True)
p = json.load(open(pj)); p['assets'] = [a for a in p['assets'] if a['kind'] != 'clip']
for f in sorted(glob.glob(os.path.join(src, '*.mp4'))):
    sid = os.path.basename(f)[:-4]; w = os.path.join(dst, sid + '.webm')
    if not os.path.exists(w):
        subprocess.run(['ffmpeg', '-nostdin', '-y', '-loglevel', 'error', '-i', f, '-vf', 'minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:vsbmc=1,scale=1920:1080:flags=lanczos,unsharp=5:5:0.6',
                        '-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-an', w], check=True)
        print('clip', sid, flush=True)
    p['assets'].append({'id': f'{sid}~clip', 'name': f'{sid} clip', 'kind': 'clip', 'url': f'file:{sid}.webm'})
json.dump(p, open(out, 'w')); print('clips attached:', sum(a['kind'] == 'clip' for a in p['assets']))
