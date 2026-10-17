# BeatFrame

Turn a song into a finished lyric music video, cut on the beat, in the browser.

BeatFrame is the engine behind the Tony Mack videos ("Miltown BBQs", "A to Z"), rebuilt as a web app you can run for yourself or sell access to. Everything that decides how the video looks and moves is plain code: beat tracking, lyric timing, the edit, camera moves, typography, transitions, grade and export. AI is only used where it adds something you can't compute (scene images, and optionally the first pass of lyric timing), and every AI step uses the customer's own key and model choice, or can be skipped entirely.

## What runs where

| Step | How it works | AI? | Cost to you |
|---|---|---|---|
| Beat, tempo, kicks, snares | Spectral-flux onsets + dynamic-programming beat tracker (TypeScript, matches librosa within one frame) | No | None, runs on the user's device |
| Lyric timing | Official lyrics aligned word by word to a transcript with a global sequence alignment. Transcript from on-device Whisper (free, in the browser), OpenAI Whisper (user key), or no AI at all via tap-sync / LRC import | Optional | None |
| Edit plan | Shots snapped to beats; one shot per line, one scene per letter (alphabet mode) or every N beats; hooks re-use their scenes; drops get punch-ins | No | None |
| Scene prompts | Templates built from the lyric, the mood and the cast; optional LLM rewrite with any provider | Optional | None |
| Scene images | OpenAI (gpt-image), Google Gemini (Nano Banana) or fal.ai (FLUX Kontext) with the user's key and their reference photos; or upload your own images | Optional | None, billed to the user's key |
| Render + export | Deterministic Canvas renderer; MP4 (H.264/AAC) via WebCodecs in Chrome/Edge/Safari, WebM fallback elsewhere | No | None, nothing is rendered on your servers |

Because rendering and analysis happen in the customer's browser and AI calls go straight to their own provider account, hosting costs stay close to a static website, however many videos people make.

## Looks

Four presets ship as starting points. Every value in them is editable in the Look step (colours, fonts, lyric position and reveal, hot words, motion, grade, particles, transitions, graphics):

- **Summer Block Party**: the Miltown BBQs look. Warm amber, Anton + Permanent Marker, street-sign pops, location captions, embers, film-burn transitions.
- **Alphabet Hustler**: the A to Z look. Steel blue and champagne gold, giant gold-foil letters, A–Z ruler, dictionary opening, letter-mask reveals, alliteration highlighting, rain, colour-split drops.
- **Neon Night Drive** and **Golden Testimony**: two more starting points.

16:9 (YouTube) and 9:16 (Reels, TikTok, Shorts) are both supported; the layout adapts. Each preset keeps its cinematic letterbox bars; the Letterbox slider in the Look step adjusts or removes them. Export at any of 480p, 720p, 1080p (default), 1440p or 4K (3840x2160, or 2160x3840 for 9:16). Every resolution renders natively from the same engine, so text and graphics stay sharp; nothing is upscaled after the fact.

## Run it

```bash
npm install
npm run dev          # studio at http://localhost:5173
npm test             # engine tests
npm run build        # static build in dist/
```

Keys are entered in the app (API keys button) and stay in the browser: localStorage, or session-only, optionally encrypted with a passphrase (AES-GCM).

## Render from the command line

Save a project from the Export step (`.beatframe.json`; it includes the timing, look, edit and images), then:

```bash
npm run build && npx vite build -c vite.engine.config.ts
node cli/beatframe.mjs render "My Song.beatframe.json" --audio song.mp3 --out video.mp4 --res 1080 --workers 3
```

It uses the same renderer as the studio, drives headless Chromium, and encodes with ffmpeg (H.264 CRF 17 + AAC 320k). Set `CHROMIUM_PATH` if Playwright's browser isn't installed. `--from` / `--to` render a slice. `--res` accepts 480, 720, 1080 (default), 1440 or 2160 (4K: 3840x2160 landscape, 2160x3840 for 9:16 projects).

The studio is also scriptable in the browser: `window.BeatFrameApp` exposes the store, every pipeline action (`loadAudio`, `alignAuto`, `planVideo`, `generateAll`, …) and `exportVideo`.

## Selling access (optional paywall)

By default there is no sign-in: good for personal use or a private install. To sell subscriptions:

1. Create a Supabase project and run `supabase/schema.sql` in its SQL editor.
2. Create a Stripe product with a recurring price.
3. Deploy to Vercel (import the repo; `vercel.json` is included).
4. Set environment variables (see `.env.example`):
   - Browser: `VITE_GATE=supabase`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - Server: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`
5. In Stripe, add a webhook to `https://<your-domain>/api/stripe-webhook` for `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`.

Users sign in with a magic link, subscribe through Stripe Checkout, and the webhook keeps `public.subscriptions` current. Row-level security lets each user read only their own row.

`api/proxy.ts` is a stateless pass-through for providers that block browser requests. It only forwards to an allow-list of AI hosts, strips cookies, and never logs keys or bodies. Users opt into it per device.

## Project layout

```
src/engine/      analysis.ts  align.ts  planner.ts  prompts.ts  styles.ts  renderer.ts  export.ts  types.ts
src/providers/   keys.ts (BYO-key vault)  images.ts  transcribe.ts + whisper.worker.ts  llm.ts
src/ui/          App.tsx  panels.tsx  Preview.tsx  Timeline.tsx  Gate.tsx
src/pipeline.ts  app actions (analyse, time, plan, generate, save/load)
cli/             headless renderer
api/             proxy, Stripe checkout and webhook (Vercel functions)
supabase/        schema for subscriptions
tests/           engine tests (vitest)
```

## Notes

- Scene images need reference photos for a consistent face: 2–4 clear, front-facing shots work best.
- Location photos can be attached per scene to recreate a real place; credit CC-licensed photos in your video description.
- The local Whisper model downloads once (≈80–250 MB depending on size) and is cached by the browser.
