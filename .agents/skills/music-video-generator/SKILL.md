---
name: music-video-generator
description: Make a finished music video from a song file plus artist photos, as a lyric video (stills + free 3D motion) or a full-motion video (AI video clips), with a choice of image and video providers.
---

# Music video generator (BeatFrame pipeline)

Turns a song (m4a/mp3/wav) plus the artist's reference photos into a 1080p music video. Lyrics land word by word on the vocal, cuts land on the beat, and every scene is written from the song's own lyrics.

Two modes (ask which if the user didn't say):
- **Lyric video**: AI stills animated by code (depth parallax, water shimmer, foliage sway, Ken Burns, beat punches). Cost is images only.
- **Full-motion video**: same edit, but every scene is a real AI video clip.

Engine and tools: the GitHub repo **natelasko528/beatframe** (`main`). Clone it and run `npm install`. You also need Node 20+, Python 3 with `faster-whisper librosa pillow`, ffmpeg (with libvpx), and Chromium for Playwright (`npx playwright install chromium`, or set `CHROMIUM_PATH`). `tools/examples/no-worries-weather/` is a complete worked example (direction, scenes, motion, alias, lyrics); match its quality.

## Rules
- Keep the cinematic letterbox bars (`grade.letterbox` ~92). Never change the look, layout or style without asking.
- Default output is 1080p, plus a phone copy (H.264, CRF 19–20, `-movflags +faststart`).
- Every creative choice comes from this song's lyrics, mood and measured features. No defaults from past songs.
- Check real prices before quoting a cost, and ask before spending paid credits. Free resources are fine.
- Render, look at frames across the whole song, and fix problems before delivering.
- Keep API keys in private files or env vars. Never print or commit them.

## Pipeline
1. **Audio + lyrics (free).** `ffmpeg -i song.m4a -ac 2 -ar 44100 track.wav`, then `python3 tools/transcribe.py track.wav words.json "Artist, Title."`. Write a clean `lyrics.txt` with `[Intro] [Hook] [Verse 1] [Bridge] [Outro]` tags. Give a distinct chant its own tag name so its lines get their own scenes.
   Start the app with `npx vite build && npx vite preview --port 4175 --host 127.0.0.1`, then run `node tools/plan.mjs --song track.wav --lyrics lyrics.txt --words words.json --title T --artist A --out plan.json`. This prints BPM, key, timed lines and one scene per lyric line.
2. **Direction (you are the director).**
   - `direction.json` in the `Direction` schema (`src/engine/stages.ts`): concept, palette, fonts from `FONT_CHOICES`, lyric layout, grade, transitions.
   - A scene list of 30–50 images. Lines that share an image go in `alias.json` (`{"S08":"S03"}`).
   - Put the artist in about 70% of scenes, and vary shot sizes, locations and the story arc.
   - Never put text, logos or brands in images.
3. **Scene images (ask which provider).**
   - OpenAI gpt-image `images/edits` with 2–3 artist photos, 1536x1024, `high` (or `medium` to save) — best face match.
   - Gemini, fal or Higgsfield are alternatives.
   - Inspect a contact sheet and regenerate anything off-brief.
4. **Assemble the project.**
   - **Lyric video:** `node tools/build.mjs --song track.wav --lyrics lyrics.txt --words words.json --title T --artist A --direction direction.json --images imgdir --alias alias.json --hot "w1,w2" --depth --out project.beatframe.json`. `--depth` adds free on-device depth maps for the 3D motion.
   - **Full-motion video:** write `motion.json` (`{"S03": "what moves + camera move"}`), then generate clips with one of these.
     - **Free (Kaggle + Wan 2.2 I2V-A14B GGUF + Lightning 4-step):** set `KAGGLE_API_TOKEN` (phone-verified account), run `python3 tools/kaggle/launch.py <user> <slug> imgdir motion.json 2`, then `python3 tools/kaggle/watch.py <user> <slug> 2 clips`. Each clip takes about 15 min at 832x480, 5 s, on 2 free T4s; the free quota is about 30 GPU-hours a week. Test 1 clip first on a new setup.
     - **Paid (Higgsfield Seedance/Kling, fal.ai, Replicate):** quote the cost first, then generate a 5 s clip per scene.
     Then run `python3 tools/attach_clips.py project.beatframe.json clips project_clips.json clipfiles`. It smooths to 30 fps, upscales to 1080p, encodes VP9 and references the clips as files. Scenes without a clip fall back to the still with depth motion.
5. **Render + verify.** `node cli/beatframe.mjs render project.json [--assets clipfiles] --audio song.m4a --out "Artist_-_Title_(Official_Video)_1080p.mp4" --res 1080 --workers 2` (about 30 min per song on 2 CPUs). Check about 12 frames across the song for lyric timing, scenes, bars, faces and stray text. Then make the phone copy and deliver.

## Gotchas
- Don't inline big clips in the project JSON; use `file:` urls plus `--assets`.
- The CLI rebuilds `dist-engine` when `src/engine` changes. If output looks stale, delete `dist-engine/`.
- `tools/kaggle/run_template.py` already handles the Kaggle memory layout (prompt encoding in a separate process, one transformer per GPU, `torchao` removed).
