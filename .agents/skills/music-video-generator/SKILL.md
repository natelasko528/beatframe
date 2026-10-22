---
name: music-video-generator
description: Make a finished music video from a song file plus artist photos, as a lyric video (stills + free 3D motion) or a full-motion video (AI video clips), with a choice of image and video providers.
---

# Music video generator (BeatFrame pipeline)

Turns an uploaded song (m4a/mp3/wav) plus the artist's reference photos into a 1080p music video. Lyrics land word by word on the vocal, cuts land on the beat, and every scene is built from the song's own lyrics.

Two modes. Ask which one if the user didn't say:
- **Lyric video**: AI stills animated by code. Each still is cut into far, mid and subject layers that glide smoothly with parallax, and the whole frame jolts on the kicks and snares. Cost is the images only.
- **Full-motion video**: same edit, but every scene is a real AI video clip (people move, waves crash, camera flies).

The engine and tools live in the repo **natelasko528/beatframe** (branch `main`). Clone it and run `npm install`. The tools are in `tools/` and the renderer CLI is `cli/beatframe.mjs`.

`tools/examples/no-worries-weather/` holds a complete worked example (direction, scenes, motion, alias, lyrics). Mirror its quality. The approved reference is **Family First v2** (Oct 2026), which used layered parallax and drum jolts. The user said "much better", so its look and motion are the default.

## Get it right the first time (saves the user money)
Every regeneration and re-render costs the user tokens and money.
- Use the approved defaults below and don't experiment on the user's dime.
- Build each step once, check it before moving on, and show a 10–15 s test render before the full render.
- Change the look, motion or layout only when the user asks.

## Standing rules (from the user)
- Keep the cinematic letterbox bars (`grade.letterbox` ~92). Never change the look, layout or style without asking first.
- Default output is 1080p, plus a phone copy (H.264 CRF 20, `+faststart`). The chat upload limit is **400 MB**, so a 4–5 min 1080p master (~460–500 MB) can't be sent. Always send the phone copy (~250 MB), which is still 1080p. Offer 480p/720p/1440p/4K only if asked.
- Nothing defaults to any past song. Every creative choice comes from this song's lyrics, mood and measured features.
- Before quoting any cost, check the real price (provider pricing or a `get_cost` preflight). Never guess. Use the cheaper quality tier when it won't show on screen.
- Before sending anything, render it, look at frames across the whole song, and fix problems first. Never send unverified work.
- Ask before spending the user's money or paid credits. Free resources (Kaggle quota) are fine to use.
- Keep API keys in `~/.secrets/<name>` (chmod 600). Never print or commit them. Remind the user to rotate any key pasted in chat.
- **Family members and children are never generated as people.** If the user says not to show their family (e.g. their daughters), use symbols instead: two roses, an empty swing, small bikes, a crayon drawing, empty chairs.
- **Send finished render sections to the chat as they complete**, with the audio, so the user can watch progress without waiting for the full render.

## Pipeline

### 1. Audio + lyrics (code, free)
- `ffmpeg -i song.m4a -ac 2 -ar 44100 track.wav`
- Transcribe with `python3 tools/transcribe.py track.wav words.json "Artist, Title. Rap lyrics."`. This uses faster-whisper medium.en on CPU (~10 min for 3.5 min of audio).
  - If the user supplied lyrics, the transcript is **only for word timing**; the on-screen text is always their exact lyrics. Say so if they ask why you're transcribing.
- Write a clean `lyrics.txt`. Use the user's lyrics if given, otherwise the fixed transcript. Tag sections `[Intro] [Hook]/[Chorus] [Verse 1] [Bridge] [Outro]`.
  - Tag a distinct chant/pre-hook with its own name (e.g. `[Island]`) so its lines get their own scenes.
  - `[Hook]`/`[Chorus]` sections reuse hook images.
- Plan the edit with `node tools/plan.mjs --song track.wav --lyrics lyrics.txt --words words.json --title T --artist A --out plan.json`. It prints BPM, key, lines (check the matched counts are high) and one scene per lyric line, with shot times.

### 2. Creative direction (you are the director)
Write `direction.json` in the `Direction` schema (`src/engine/stages.ts`):
- concept, world, mood/grade, palette (6 hex), fonts (from `FONT_CHOICES`), lyric layout and reveal, energy, grade (letterbox 92), particles, transitions and graphics.
- Set `graphics.titleOnDrops: false`. The chorus lyric already boxes the title, and a second title lockup slides in clipped at the frame edge.

Write the scene list (see `examples/.../scenes.json`):
- About 30–75 images. Merge lines that share an image via `alias.json` (`{"S08": "S03"}`).
- Vary shot sizes and locations, and give the video a story arc.
- Put the artist in ~70% of scenes. Write identity text once and reuse it in every prompt.
- Keep romance tasteful.

Per-scene FX in `fx.json` (`{"S07":["snow"]}`), chosen by lyric meaning:
- `rain` / `snow` / `embers` / `dust`
- `rays` (god rays) / `flare` (anamorphic sweep)
- `petals` (rose petals) / `sparks`

### 3. Scene images (choose provider)
Ask which provider; default to OpenAI if a funded key exists.
- **OpenAI gpt-image** (best face match): `/v1/images/edits` with 2–3 artist reference photos, 1536x1024, quality `high` (use `medium` to save money). Run 3 in parallel. Check the key has credit first with a tiny `low` call.
- **Gemini / fal / Higgsfield** (`mcp__Higgsfield__generate_image_batch`, preflight `get_cost`) are alternatives.
- **Canva `generate-image`**: matches faces well but has a small quota, and only thumbnails are downloadable. For full resolution, place images in a design and use `export-design`.

**Avoid regeneration rounds.** Family First needed 3 rounds because of these mistakes:
- **Crop every reference photo to the face and shoulders before use.** Pendants, shirt prints, posters or any lettering in a reference get copied into every image. A "TONY MACK" pendant spread through a whole batch this way.
- Every prompt ends with: `No text, no letters, no numbers, no logos, no signs, no banners, no lettering on clothing — plain unbranded clothes.`
- Don't name the city in prompts ("Milwaukee"). The model paints the name on signs; describe the skyline instead.
- Compose for layers: a clear subject in the mid-foreground, separated from a deep background (skyline, street, window light). This gives the parallax real depth.
- Write prompts for symbol scenes as objects only, with no person anywhere.

Make contact sheets and inspect every image. Regenerate only the images that are off-brief or contain text; keep the rest.

### 4a. Lyric video: layered parallax (APPROVED DEFAULT)
1. Build the project with depth maps (Depth Anything V2, free, ~12 s per image on CPU). Set `--strength 1`.
   ```
   node tools/build.mjs --song track.wav --lyrics lyrics.txt --words words.json --title T --artist A \
     --direction direction.json --images imgdir --alias alias.json --fx fx.json --strength 1 \
     --hot "word1,word2" --depth --out project.beatframe.json
   ```
2. Split every still into 3 layers:
   ```
   pip install --break-system-packages "rembg[cpu]"     # once; downloads isnet-general-use (~180 MB) from GitHub
   python3 tools/layers.py project.beatframe.json layers/
   ```
   This takes about 3 s per image. It writes `layers/<id>_L0/L1/L2.webp` and adds layer assets plus each scene's `anchor` (the subject's head) to the project.
   - **L2 subject**: the artist or symbol object, cut out with a salient-object matte so a person is never split across layers.
   - **L1 mid**: far/mid split by depth, with the subject's footprint inpainted.
   - **L0 far**: the background, with everything in front of it inpainted.
3. Contact-sheet the L2 subject layers (on magenta) and check that each subject is a clean cutout.

How the renderer moves it (`renderer.ts`: `layered()`, `buildHits()`, `jolt()`). This is the approved motion; don't change it unless asked.
- **Layers:** each layer is a rigid plane gliding from the first frame of the shot to the last. Speeds are far 0.35×, mid 1×, subject 1.12×, and subject +6.5% / mid +2.5% zoom over the shot. The camera push pivots on the subject's head, so the face stays in frame. Nothing inside a layer warps.
- **Drum jolts:** one whole-frame jolt per clean drum hit, at most one per beat, and only where a kick or snare lands. Hi-hats never trigger it. Each jolt is an instant knock that settles on a damped spring over ~0.35 s.
  - Snares hit harder than kicks, choruses harder than verses, and drops hardest. Quiet passages are softer.
  - Lyrics and FX ride the same frame.
  - Strength scales with `style.motion.shake` (3 = approved).
- **Never** use per-pixel depth warping (the old `living()` shader), high-frequency shake, per-image kick zoom, or water/foliage shimmer on lyric videos. The user rejected all of these as "jittery and distorted". Without layers the renderer falls back to the shader. Always run `layers.py`.

Then go to step 5.

### 4b. Full-motion video (AI clips; choose provider)
Write `motion.json` with one line per scene: what moves plus the camera move (see the example).
- **Free: Kaggle + Wan 2.2 I2V-A14B (GGUF Q4) + Lightning 4-step LoRA.** This is the default.
  - Needs the user's Kaggle API token in `~/.secrets/kaggle_token` (env `KAGGLE_API_TOKEN`), on a phone-verified account.
  - Launch with `python3 tools/kaggle/launch.py <user> <slug> imgdir motion.json 2`.
  - It makes a private dataset and 2 runs on 2x T4 each. Expect ~15 min per clip at 832x480, 5 s, 16 fps, using about 0.25 GPU-h per clip of the ~30 h/week free quota.
  - Collect with `python3 tools/kaggle/watch.py <user> <slug> 2 clips` (blocks until done; poll in the background and schedule a check-in).
  - Kaggle only returns output after a run ends. Do a 1-clip test first on a new setup.
  - Faces stay consistent with 14B. The 5B model drifts, so don't use it.
- **Higgsfield** (paid credits): `generate_video_batch`, image role from `models_explore`.
  - Seedance about 35 credits per 5 s clip; Kling 3.0 is cheaper.
  - Preflight `get_cost`, quote the total, and get approval.
- **fal.ai / Replicate** (paid per clip, Kling / Wan / Seedance): same rules — preflight, quote, approve.

Then:
- Attach the clips with `python3 tools/attach_clips.py project.beatframe.json clips project_clips.json clipfiles`. It smooths to 30 fps, upscales to 1080p and encodes VP9 (sandbox Chromium can't decode H.264).
- Scenes without a clip fall back to the layered still. Run `layers.py` too.
- The drum jolts apply to clip scenes as well.

### 5. Test, render, verify, deliver
1. **Test first (once).** Render 10–15 s of the first chorus and look at frames:
   ```
   CHROMIUM_PATH=/opt/pw-browsers/chromium node cli/beatframe.mjs render project.beatframe.json \
     --assets layers --audio song.mp3 --out test.mp4 --res 1080 --from <hook-3> --to <hook+11> --workers 2
   ```
   Send it to the user. Proceed to the full render without waiting unless something is wrong.

2. **Full render: checkpointed and parallel.**
   ```
   CHROMIUM_PATH=/opt/pw-browsers/chromium python3 tools/render_chunks.py project.beatframe.json \
     --assets layers --audio song.mp3 --out "Artist_-_Title_(Official_Video)_1080p.mp4" --chunks 12 --jobs 2
   ```
   Run it in the background and don't poll with `sleep`.
   - Speed with layers is ~5 fps on 2 cores, so ~30 min for a 4.5-min song. The old shader path ran at 1.5 fps.
   - Each chunk is validated (exact frame count) and kept; the cache key covers the project, engine and layers. Re-running after a crash renders only the missing chunks.
   - The chunks are joined with `-c copy` and the audio is added once (AAC 320k).
   - As chunks finish, send them to the user with audio (`-ss <chunk start>` on the song).
   - The CLI loads only the assets each chunk needs, so memory stays flat.

3. **Verify.**
   - `ffprobe -count_frames`: the frame count must equal `round(dur*30)`, and the duration must match the song.
   - Motion check: phase-correlate consecutive 240-px gray frames. Within-shot motion should be smooth (median about 0.05 px). Big jumps only at cuts, transitions and drum hits, and no rapid back-and-forth flicker.
   - Look at frames on both sides of each chunk seam.
   - Make a 12-frame contact sheet across the song and check that the lyrics are in time, the bars are present, faces are in frame, the images contain no text, and there are no halos around subjects.

4. **Deliver.** Make the phone copy, check it, and send it with SendUserFile:
   ```
   ffmpeg -i master.mp4 -c:v libx264 -threads 2 -crf 20 -preset medium -movflags +faststart -c:a copy phone.mp4
   ```

## Gotchas learned the hard way
- **Never start another Chromium/render while a render is running.** The sandbox has 2 cores and ~8 GB, and a side benchmark OOM-killed a 50%-done render.
- `pkill -f <pattern>` can match your own shell command and kill it. Kill by PID.
- `cli/beatframe.mjs` rebuilds `dist-engine` automatically when `src/engine` changes. If a render looks stale, delete `dist-engine/`.
- Never inline big clips or layers in the project JSON. Use `file:` URLs plus `--assets`.
- Speed: drawing is ~92% of render time and JPEG/encode ~8%. More machines help; encoder tweaks barely do.
- Kaggle Wan runs:
  - Uninstall `torchao` first.
  - Encode prompts in a separate process under `torch.set_grad_enabled(False)`.
  - Put transformer high-noise on cuda:0, low-noise and the VAE on cuda:1, with `AlignDevicesHook`.
  - Pass the transformer and VAE into `from_pretrained` so the scale factors are right.
  - `tools/kaggle/run_template.py` already does all of this.
- Container restarts kill background jobs. Re-check that outputs exist before reporting; `render_chunks.py` resumes.

## Finish
Tell the user in a few lines:
- what was made
- what was verified
- the real cost (image calls; tell them to check the provider usage page rather than guessing)
- any known weakness (e.g. a stray background sign)
- one next step

Don't recap every step.
