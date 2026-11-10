---
name: music-video-generator
description: Make a finished music video from a song file plus artist photos, as a lyric video (stills + free 3D motion) or a full-motion video (AI video clips), with a choice of image and video providers.
---

# Music video generator (BeatFrame pipeline)

Turns an uploaded song (m4a/mp3/wav) plus the artist's reference photos into a 1080p music video. Lyrics land word by word on the vocal, cuts land on the beat, and every scene is built from the song's own lyrics.

Two modes. Ask which one if the user didn't say:
- **Lyric video** (default): photoreal 4K AI plates animated by code like a real rap video.
  - Each scene is a stack of real layers (clean background, mid, subject, and a foreground element past the lens).
  - On top runs a motion-graphics edit: beat-cut camera angles, whip/zoom/glitch transitions, slamming chorus words, stamped call-outs, shockwaves, and whole-frame drum jolts.
  - Cost is the images only.
- **Full-motion video**: same edit, but every scene is a real AI video clip (people move, waves crash, camera flies).

The engine and tools live in the repo **natelasko528/beatframe** (branch `main`). Clone it and run `npm install`. The tools are in `tools/` and the renderer CLI is `cli/beatframe.mjs`.

`tools/examples/no-worries-weather/` holds a complete worked example (direction, scenes, motion, alias, lyrics). Mirror its quality.

Approved references:
- **Family First v2** (Oct 2026): layered parallax plus drum jolts. The user said "much better".
- **Big Money** (Nov 2026): adds GPT Image 2.6 4K plates, real Milwaukee location refs and the motion-graphics pass. The user asked for "more action, to the beat, like a real music video, not a slideshow".

Their look and motion are the default.

**About "Claude Motion":** it's real, Anthropic's code-based animation feature (beta, Oct 2026, exports MP4). It's **Team/Enterprise only**, enabled by an admin under Organization settings > Artifacts, and it doesn't do realistic people or full songs. If the Artifact tool lists a Motion type, use it for short add-ons (animated title card, end credits, 15 s social teaser) and splice its MP4 into the render. Otherwise BeatFrame's own motion-graphics pass (below) does the same job inside the video. Check the list rather than assuming.

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
- **Photoreal first, effects in post.**
  - Images must look like real photographs: real skin, real light, no CGI or airbrushed look.
  - All music-video effects (grade, glitches, cash, flares) are added by the engine, never baked into the images.
- **Real locations.** Use real reference photos of the artist's city (Milwaukee for Tony Mack) for every outdoor scene. A generic skyline is a fail.
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
- Start the app: `npx vite build && npx vite preview --port 4175 --host 127.0.0.1` (background). Set `CHROMIUM_PATH=/opt/pw-browsers/chromium` in this sandbox.
- Plan the edit with `node tools/plan.mjs --song track.wav --lyrics lyrics.txt --words words.json --title T --artist A --out plan.json`. It prints BPM, key, lines (check the matched counts are high) and one scene per lyric line, with shot times.

### 2. Creative direction (you are the director)
Write `direction.json` in the `Direction` schema (`src/engine/stages.ts`):
- concept, world, mood/grade, palette (6 hex), fonts (from `FONT_CHOICES`), lyric layout and reveal, energy, grade (letterbox 92), particles, transitions and graphics.
- Match the song: e.g. island song → warm gold + turquoise, Caveat hot words, light-sweep transitions; heartfelt rap → golden hour + amber/red accents, Playfair hot words, film-burn transitions.
- Set `graphics.titleOnDrops: false`. The chorus lyric already boxes the title, and a second title lockup slides in clipped at the frame edge.

Write the scene list (see `examples/.../scenes.json`):
- About 30–75 images. Merge lines that share an image via `alias.json` (`{"S08": "S03"}`).
- Vary shot sizes and locations, and give the video a story arc.
- Put the artist in ~70% of scenes. Write identity text once and reuse it in every prompt.
- No readable text, logos or brands in images. Keep romance tasteful.

Per-scene FX in `fx.json` (`{"S07":["snow"]}`), chosen by lyric meaning:
- `rain` / `snow` / `embers` / `dust`
- `rays` (god rays) / `flare` (anamorphic sweep)
- `petals` (rose petals) / `sparks`

### 3. Scene images: GPT Image 2.6 plates built for motion (default provider: OpenAI)
Key: `~/.secrets/openai`. If it's dead ("invalid API key"), ask for a new one; never print it.

**References**
- **Identity:** the artist's real photos, cropped to face and shoulders (Tony Mack's real photos: `/home/claude/bm/refs/n1–n4.jpg` in this workspace; ask for new photos if they're gone), plus the 1–2 best faces from earlier videos (`r1.jpg`, `r3_ff.jpg`). Up to 5 refs.
- **Location:** one real photo per outdoor scene, appended as the **last** ref. Source them from Wikimedia Commons:
  - Use the API `generator=search` with a User-Agent header, 2 s between requests (it rate-limits; on HTTP 429 wait about a minute).
  - Download the `iiurlwidth=1600` thumbnails.
  - Milwaukee set: lakefront skyline with the Art Museum wings, Hoan Bridge, Third Ward streets.

**Prompt shape** (see `tools/examples/big-money/scenes.py`):
```
Create a completely NEW cinematic wide shot (not a portrait, do not copy any reference photo's pose, framing, clothing or background).
SCENE: <idea>  LOCATION: the real city in the LAST reference image … all signs blank, no names or logos on buildings …
CAMERA: medium-wide, the man fills 45–60% of frame height.  IDENTITY: use the first reference photos only for the man's face …
PHOTOREALISM: real photograph, ARRI Alexa 35 + Cooke anamorphic, skin pores, real fabric, physically accurate light; not CGI, no airbrushed skin, no HDR halo …
Gangster rap video energy: low angle, confident body language, hard contrast …
Composed for multilayer parallax: man at mid-depth on a third, clear space around his silhouette, deep background, one out-of-focus foreground element at a frame edge, nothing important in the outer 10% …
No text, no letters, no numbers, no logos, no signs, no lettering on clothing.
```
- Without the "NEW wide shot … not a portrait" opener, edits with refs return copies of the ref portraits.
- **Never name landmarks or the city** (e.g. "Third Ward", "US Bank"): the model paints them as signs. Describe them instead and let the location photo carry it.
- Gangster rap craft:
  - artist in ~70% of shots
  - low-angle hero shots and crew stacked behind him
  - flex props (cars, cash, chains, cigars)
  - "came from little" vs "made it" contrast scenes
  - wet night streets, performance shots with a mic
- **Safety filter:** rephrase, don't argue. An "elegant woman in an evening dress teasing him" was blocked as sexual; "business partner in a blazer laughing in the doorway" passed. Brand names (Cadillac) can trip it too. Blocked calls aren't billed.

**Generate**
```
python3 tools/plates.py jobs.json plates --threads 2      # 3 max; 6 threads OOM-killed the sandbox
```
- **Hero plate:** `gpt-image-2.6-sunburst` edits, 3840×2160, quality high.
- **Clean background plate:** a masked edit ("remove the man, rebuild what was behind him"), then automatically warped onto the hero with a SIFT homography. The subject area is filled from it, so it lines up exactly ("clean plate aligned" in the log).
- **Foreground sprites:** jobs with `"sprite": true` use `gpt-image-2.6-flare` with `background: transparent`, which works on 2.6. The standard set is cash, smoke, gold confetti, champagne, sparks, rain, bokeh, chain-link fence.
- Skips existing files, so re-run after any crash. Check for truncated PNGs after a container restart.
- Prints token usage. Real cost was about **$0.26 per scene** (hero + clean at 4K high) and about $0.03 per sprite, so about $11–12 for 40 scenes + 8 sprites.

Make contact sheets of every hero and check:
- likeness
- real-city look
- no text or signs: crop or regenerate if needed

Regenerate only the failures.

### 4a. Lyric video: layered plates + motion graphics (APPROVED DEFAULT)
1. **Map lines to concepts.** `mapping.json` maps scene ids to concepts, and the first scene per concept gets the image; the rest go in `alias.json`. `tools/examples/big-money/assemble.py` then writes `imgs/S##.jpg` (1920 px, for depth), `splates/S##.png` and `S##_bg.png` (4K symlinks), and `fx.json` / `fg.json`.
2. **Build** with depth maps:
   ```
   node tools/build.mjs --song track.wav --lyrics lyrics.txt --words words.json --title T --artist A \
     --direction direction.json --images imgs --alias alias.json --fx fx.json --strength 1 --hot "W1,W2" --depth --out project.beatframe.json
   ```
3. **Layers from the 4K plates**, using the real clean background:
   ```
   LAYER_JOBS=1 python3 tools/layers.py project.beatframe.json layers --plates splates
   ```
   Needs `pip install --break-system-packages "rembg[cpu]"`. It skips scenes already split (`layers/anchors.json`), so after a rebuild it only does new ones. Contact-sheet the L2 subjects on magenta.
4. **Motion graphics pass:**
   ```
   python3 tools/motiongfx.py project.beatframe.json --assets layers --fg fg.json --sprites plates
   ```
   Then set `style.lyrics.size` to about 110 for condensed fonts like Anton; 84 reads too small.
   - `lyrics.slam`:
     - Chorus words slam in on their beat (scale 2.1→1).
     - `(WHO?)` / `(TONY!)` call-outs become tilted stamped tags.
     - In big sections, shockwave rings on strong hits, light streaks on alternate hits, and speed lines on drops.
   - `tools/beatcut.py`:
     - Splits shots on the beat grid: every 2 beats in hooks, 4 in verses and bridge.
     - Gives each cut a camera angle: 0 wide, 1 medium, 2 close (needs 4K), 3 crane, 4 pull-back. All are framed on the subject's head and never repeat back-to-back.
     - Gives each cut a drum-matched transition: snare → whip pan, kick → zoom punch, section/drop → RGB glitch.
     - Re-runnable: keeps `shotsBase`.
   - Foreground sprites glide past the lens with a soft hole cut where the face is, so they frame him instead of covering him. Bokeh runs at 40% opacity.
5. **Layer motion and jolts** are unchanged from Family First v2:
   - far 0.35× / mid 1× / subject 1.12× lateral, with subject +6.5% zoom pivoting on the head
   - one whole-frame damped jolt per clean kick or snare hit, never on hi-hats
   - Never per-pixel warping, high-frequency shake, or shimmer.

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
- Scenes without a clip fall back to the layered still. Run `layers.py` and `motiongfx.py` too.
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
   - Speed is about 5 fps on 2 cores with 4K layers and motion graphics, so ~25 min for a 4-min song.
   - Each chunk is validated (exact frame count) and kept; the cache key covers the project, engine and layers. Re-running after a crash renders only the missing chunks.
   - The chunks are joined with `-c copy` and the audio is added once (AAC 320k).
   - As chunks finish, send them to the user with audio (`-ss <chunk start>` on the song).
   - The CLI loads only the assets each chunk needs, so memory stays flat.

3. **Verify.**
   - `ffprobe -count_frames`: the frame count must equal `round(dur*30)`, and the duration must match the song.
   - Motion check: phase-correlate consecutive 240-px gray frames. Within-shot motion should be smooth (median about 0.05–0.1 px at 240 px wide; Big Money measured 0.11). Big jumps only at cuts, transitions and drum hits, and no rapid back-and-forth flicker.
   - Look at frames on both sides of each chunk seam.
   - Make a 12-frame contact sheet across the song and check that the lyrics are in time, the bars are present, faces are in frame, the images contain no text, and there are no halos around subjects.

4. **Deliver.** Make the phone copy, check it, and send it with SendUserFile:
   ```
   ffmpeg -i master.mp4 -c:v libx264 -threads 2 -crf 20 -preset medium -movflags +faststart -c:a copy phone.mp4
   ```

## Gotchas learned the hard way
- **Memory (~8 GB):** plate generation with 6 threads, or with a build running beside it, got OOM-killed. Use ≤2–3 threads and `LAYER_JOBS=1` for 4K layers.
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
- the real cost: sum the token lines `plates.py` prints (runs killed mid-way don't print theirs, so say so), or $0 + Kaggle hours; point the user to the provider usage page
- any known weakness (e.g. a stray background sign; in full-motion videos, 480p clips upscaled are a bit softer, 720p is sharper but 2–3x slower)
- one next step

Don't recap every step.
