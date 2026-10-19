#!/usr/bin/env python3
"""Generate image-to-video clips for free on Kaggle (Wan 2.2 I2V-A14B GGUF Q4 + Lightning 4-step; ~15 min/clip on 2x T4).
Usage: KAGGLE_API_TOKEN=... launch.py <kaggle_user> <slug> scenes_dir motion.json [parts=2]
  scenes_dir: SXX.jpg/png images. motion.json: {"S03": "what moves + camera move", ...}
Then: watch.py <kaggle_user> <slug> [parts] downloads clips/*.mp4 when the runs finish."""
import sys, os, json, subprocess, shutil
from PIL import Image
user, slug, src, mfile = sys.argv[1:5]; parts = int(sys.argv[5]) if len(sys.argv) > 5 else 2
M = json.load(open(mfile)); here = os.path.dirname(os.path.abspath(__file__)); work = os.path.abspath(f'kaggle-{slug}')
STYLE = " Cinematic music video shot, natural realistic motion, consistent face and identity."
NEG = "static, frozen, blurry, distorted face, changing face, morphing, deformed hands, extra limbs, extra people appearing, text, watermark, low quality, flicker"
ds = os.path.join(work, 'ds'); os.makedirs(ds, exist_ok=True); jobs = []
for k in sorted(M):
    f = next((os.path.join(src, k + e) for e in ('.png', '.jpg', '.jpeg', '.webp') if os.path.exists(os.path.join(src, k + e))), None)
    if not f: print('no image for', k); continue
    im = Image.open(f).convert('RGB'); w, h = im.size; ch = int(w * 480 / 832); top = max(0, (h - ch) // 2)
    im.crop((0, top, w, top + min(ch, h))).resize((832, 480), Image.LANCZOS).save(os.path.join(ds, k + '.jpg'), quality=93)
    jobs.append({'id': k, 'prompt': M[k] + STYLE, 'neg': NEG})
json.dump(jobs, open(os.path.join(ds, 'jobs.json'), 'w'), indent=1)
json.dump({'title': f'{slug}-scenes', 'id': f'{user}/{slug}-scenes', 'licenses': [{'name': 'CC0-1.0'}]}, open(os.path.join(ds, 'dataset-metadata.json'), 'w'))
r = subprocess.run(['kaggle', 'datasets', 'create', '-p', ds, '-q'], capture_output=True, text=True)
if 'already' in (r.stdout + r.stderr).lower(): subprocess.run(['kaggle', 'datasets', 'version', '-p', ds, '-m', 'update', '-q'])
tpl = open(os.path.join(here, 'run_template.py')).read()
for i in range(parts):
    d = os.path.join(work, f'k{i}'); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'run.py'), 'w').write(tpl.replace('__PART__', str(i)).replace('__NPART__', str(parts)))
    json.dump({'id': f'{user}/{slug}-{i}', 'title': f'{slug}-{i}', 'code_file': 'run.py', 'language': 'python', 'kernel_type': 'script', 'is_private': True,
               'enable_gpu': True, 'enable_internet': True, 'machine_shape': 'NvidiaTeslaT4', 'dataset_sources': [f'{user}/{slug}-scenes'],
               'competition_sources': [], 'kernel_sources': []}, open(os.path.join(d, 'kernel-metadata.json'), 'w'))
    print(subprocess.run(['kaggle', 'kernels', 'push', '-p', d], capture_output=True, text=True).stdout.strip().splitlines()[-1])
print(f'{len(jobs)} clips queued in {parts} runs (~{round(len(jobs) / parts * 15 / 60, 1)} h each).')
