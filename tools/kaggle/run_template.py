# Free motion clips for BeatFrame — rendered on Kaggle's free 2x T4 by tools/kaggle/launch.py.
# BeatFrame: Wan 2.2 I2V-A14B (GGUF Q4_K_M) + Lightning 4-step, batch of scenes on 2x free Kaggle T4.
import subprocess, sys, time, os, json, glob, traceback
PART, NPART = __PART__, __NPART__
t0 = time.time()
subprocess.run([sys.executable, '-m', 'pip', 'uninstall', '-y', '-q', 'torchao'])
subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', '-U', 'git+https://github.com/huggingface/diffusers', 'transformers', 'accelerate', 'peft', 'gguf', 'ftfy', 'imageio', 'imageio-ffmpeg'], check=True)
os.environ['PYTORCH_CUDA_ALLOC_CONF'] = 'expandable_segments:True'
import torch
from PIL import Image
from huggingface_hub import hf_hub_download
from diffusers import WanImageToVideoPipeline, WanTransformer3DModel, AutoencoderKLWan, GGUFQuantizationConfig
from diffusers.utils import export_to_video
from accelerate.hooks import add_hook_to_module, AlignDevicesHook
D = os.path.dirname(glob.glob('/kaggle/input/**/jobs.json', recursive=True)[0])
jobs = json.load(open(f'{D}/jobs.json')); jobs = jobs[PART::NPART]
os.makedirs('clips', exist_ok=True)
print('part', PART, len(jobs), 'jobs; setup', round(time.time()-t0), 's', flush=True)
BASE = 'Wan-AI/Wan2.2-I2V-A14B-Diffusers'
enc = """
import torch, sys, json
from transformers import UMT5EncoderModel
from diffusers import WanImageToVideoPipeline
name, jf = sys.argv[1], sys.argv[2]
jobs = json.load(open(jf))
te = UMT5EncoderModel.from_pretrained(name, subfolder='text_encoder', torch_dtype=torch.float16).to('cuda:1')
pipe = WanImageToVideoPipeline.from_pretrained(name, text_encoder=te, transformer=None, transformer_2=None, vae=None, torch_dtype=torch.float16)
out = {}
torch.set_grad_enabled(False)
for j in jobs:
    pe, _ = pipe.encode_prompt(prompt=j['prompt'], do_classifier_free_guidance=False, device='cuda:1'); out[j['id']] = pe.cpu()
torch.save(out, 'emb.pt')
"""
json.dump(jobs, open('myjobs.json', 'w')); open('enc.py', 'w').write(enc)
subprocess.run([sys.executable, 'enc.py', BASE, 'myjobs.json'], check=True)
emb = torch.load('emb.pt'); print('prompts encoded', round(time.time()-t0), 's', flush=True)
def gguf(sub, fn, dev):
    p = hf_hub_download('QuantStack/Wan2.2-I2V-A14B-GGUF', fn)
    return WanTransformer3DModel.from_single_file(p, quantization_config=GGUFQuantizationConfig(compute_dtype=torch.float16), config=BASE, subfolder=sub, torch_dtype=torch.float16).to(dev)
tr = gguf('transformer', 'HighNoise/Wan2.2-I2V-A14B-HighNoise-Q4_K_M.gguf', 'cuda:0')
tr2 = gguf('transformer_2', 'LowNoise/Wan2.2-I2V-A14B-LowNoise-Q4_K_M.gguf', 'cuda:1')
vae = AutoencoderKLWan.from_pretrained(BASE, subfolder='vae', torch_dtype=torch.float32).to('cuda:1'); vae.enable_tiling()
pipe = WanImageToVideoPipeline.from_pretrained(BASE, text_encoder=None, transformer=tr, transformer_2=tr2, vae=vae, torch_dtype=torch.float16)
L = 'Wan2.2-I2V-A14B-4steps-lora-rank64-Seko-V1'
pipe.load_lora_weights('lightx2v/Wan2.2-Lightning', weight_name=f'{L}/high_noise_model.safetensors', adapter_name='hi')
pipe.load_lora_weights('lightx2v/Wan2.2-Lightning', weight_name=f'{L}/low_noise_model.safetensors', adapter_name='lo', load_into_transformer_2=True)
add_hook_to_module(pipe.transformer_2, AlignDevicesHook(execution_device='cuda:1', io_same_device=True), append=True)
add_hook_to_module(pipe.vae, AlignDevicesHook(execution_device='cuda:1', io_same_device=True), append=True)
add_hook_to_module(pipe.transformer, AlignDevicesHook(execution_device='cuda:0', io_same_device=True), append=True)
print('ready', round(time.time()-t0), 's', flush=True)
log = []
for j in jobs:
    t1 = time.time()
    try:
        img = Image.open(f"{D}/{j['id']}.jpg").convert('RGB')
        frames = pipe(image=img, prompt_embeds=emb[j['id']].to('cuda:0'), height=480, width=832, num_frames=81, num_inference_steps=4,
                      guidance_scale=1.0, guidance_scale_2=1.0, generator=torch.Generator('cpu').manual_seed(7)).frames[0]
        export_to_video(frames, f"clips/{j['id']}.mp4", fps=16)
        log.append({'id': j['id'], 's': round(time.time()-t1)})
    except Exception as e:
        log.append({'id': j['id'], 'error': repr(e)[:300]}); traceback.print_exc()
    print(log[-1], 'elapsed', round((time.time()-t0)/60), 'min', flush=True)
    json.dump(log, open('log.json', 'w'))
    if time.time() - t0 > 11.3 * 3600: print('stopping before the 12h limit', flush=True); break
for f in ['emb.pt', 'enc.py', 'myjobs.json']:
    try: os.remove(f)
    except Exception: pass
