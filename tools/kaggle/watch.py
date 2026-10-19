#!/usr/bin/env python3
"""Wait for the Kaggle clip runs, then download clips. Usage: watch.py <kaggle_user> <slug> [parts=2] [out_dir=clips]"""
import sys, subprocess, time, os, glob, shutil, json
user, slug = sys.argv[1:3]; parts = int(sys.argv[3]) if len(sys.argv) > 3 else 2; out = sys.argv[4] if len(sys.argv) > 4 else 'clips'
os.makedirs(out, exist_ok=True)
while True:
    st = [subprocess.run(['kaggle', 'kernels', 'status', f'{user}/{slug}-{i}'], capture_output=True, text=True).stdout for i in range(parts)]
    if not any('RUNNING' in s or 'QUEUED' in s for s in st): break
    time.sleep(60)
for i in range(parts):
    d = f'kaggle-{slug}/out{i}'; os.makedirs(d, exist_ok=True)
    subprocess.run(['kaggle', 'kernels', 'output', f'{user}/{slug}-{i}', '-p', d], capture_output=True)
    for f in glob.glob(f'{d}/clips/*.mp4'): shutil.copy(f, out)
    lj = f'{d}/log.json'
    print(f'run {i}:', st[i].strip().split()[-1], '|', (json.load(open(lj)) if os.path.exists(lj) else 'no log (read the .log file)'))
print(len(glob.glob(f'{out}/*.mp4')), 'clips in', out)
