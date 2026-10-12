# UGC Ads Studio (POC)

Upload a product (photos and/or a product page URL) and get ready-to-run ads:

- **Static ads** in 1:1, 4:5 and 9:16 — AI scene around the real product, headline/CTA rendered in code
- **Product video** (~16s + end card) — 2 Veo shots, Gemini TTS voiceover, burned-in captions
- **UGC avatar video** (~24s + end card) — AI creator holding the product, speaking 3 script lines

Runs locally only. Plan and costs: [`../ugc-ads-poc-plan.md`](../ugc-ads-poc-plan.md).

## How it works

```
Browser ──► Next.js (UI + Server Actions) ──► Postgres (data + pg-boss queue)
                                                      │
                                    Worker (Node) ◄───┘
                                      ├─ Gemini 3.8 Flash   → brand profile, angles, copy
                                      ├─ Nano Banana 2.1    → scene images / frames
                                      ├─ Veo 3.1 Lite       → video clips
                                      ├─ Gemini Flash TTS   → voiceover
                                      ├─ Satori + resvg     → ad text overlays, captions, end card
                                      └─ FFmpeg             → normalize, stitch, mix, burn captions
                                                      │
                                         ./storage (local files)
```

The web app only writes rows and enqueues jobs; all slow AI work happens in the worker.
Every paid API call is logged to `cost_events` and shown per product in the UI.

## Setup

Requirements: Node 20+ (tested on 24), FFmpeg (`brew install ffmpeg`), a Postgres database
(Neon or Supabase), and a Gemini API key with billing enabled.

```bash
npm install
cp .env.example .env.local      # then fill in DATABASE_URL and GEMINI_API_KEY
```

**Database URL:** use the *direct* connection string.
- Neon: the non-pooled URL (host without `-pooler`).
- Supabase: the direct connection or the **session** pooler (port 5432), not the transaction pooler (6543).

pg-boss creates its own `pgboss` schema on first start.

## Run

One command (checks setup, applies migrations, starts web + worker):

```bash
npm run dev:all
```

Then open http://localhost:3000. Press Ctrl+C once to stop gracefully (running
videos finish first); press it again to force quit — interrupted items can be
retried later without paying again.

Separately, if you prefer: `npm run dev` (web) and `npm run worker` (jobs).

## Cost controls

| Protection | How |
| --- | --- |
| Nothing paid twice | Every paid output (scenes, frames, clips, voiceover) is saved in the asset folder. **Retry** and **Re-render** reuse them; only missing parts are paid for. |
| Free re-render | After editing the brand, **Re-render (free)** redraws text/captions/colors from saved scenes and clips. |
| Interrupted Veo renders resume | Veo operation IDs are saved; a retry picks up the same render instead of starting a new one. |
| Transient errors retried for free | 429/5xx/network errors are retried per call with backoff (they are not billed). |
| Partial failures keep finished parts | Parallel clips all finish and are saved before an error is reported. |
| No duplicate spend | Generate skips items that already exist (tick **New variants** to override). |
| Budget per click | `MAX_BATCH_USD` (default $5) caps the estimated cost of one Generate. |
| Shared static scene | One scene serves the 1:1, 4:5 and 9:16 ads of an angle (`STATIC_SCENE_MODE=shared`). |
| Deletes can't strand spend | Delete/Re-analyze are blocked while jobs run; jobs stop before the next paid call if their asset disappears. Re-analyze keeps angles that have ads. |
| Accurate ledger | `cost_events` has no foreign keys, so spend is kept even for deleted items. Total spend shows on the home page. |
| No unpriced models | The worker refuses to start if a configured model has no price in `src/lib/pricing.ts`. |
| Serverless DB can sleep | The worker is woken by LISTEN/NOTIFY and polls only every 15s when idle. |

## Project layout

| Path | What it does |
| --- | --- |
| `src/app/actions.ts` | Server Actions: create product, edit brand, generate/regenerate/delete assets |
| `src/app/products/[id]/page.tsx` | Product page: brand profile, angles, gallery, cost table |
| `src/app/api/files/[...path]` | Serves stored media (with Range support for video) |
| `src/app/api/products/[id]/download` | Zip of all finished assets + captions |
| `src/lib/ai/` | Gemini clients: structured text, images, TTS, Veo |
| `src/lib/ai/copy.ts` | Prompts + Zod schemas for brand analysis and ad angles |
| `src/lib/render/` | Satori templates: static ad layout, video captions, end card |
| `src/lib/media/` | FFmpeg wrappers and caption timing |
| `src/lib/pricing.ts` | Model prices and cost logging |
| `src/worker/` | pg-boss worker and one file per job type |
| `drizzle/` | SQL migrations (`npm run db:generate` after schema changes) |

## Configuration

Optional variables in `.env.local`:

| Variable | Default |
| --- | --- |
| `GEMINI_TEXT_MODEL` | `gemini-3.8-flash` |
| `GEMINI_IMAGE_MODEL` | `gemini-nano-banana-2.1` |
| `GEMINI_TTS_MODEL` | `gemini-3.8-flash-tts` |
| `VEO_MODEL` | `veo-3.1-lite-generate-preview` |
| `VIDEO_RESOLUTION` | `720p` (`1080p` costs $0.08/s instead of $0.05/s) |
| `STORAGE_DIR` | `./storage` |

If you change a model, add its price to `src/lib/pricing.ts` so cost tracking stays accurate.

## Known limitations (POC)

- No auth: keep it on localhost.
- Failed jobs are not retried automatically; click **Retry** (reuses finished parts).
- Run a single worker process (startup marks leftover "running" items as interrupted).
- Caption timing is estimated from word counts (no word timestamps from TTS/Veo).
- On-image text uses Inter (Latin scripts); emoji are stripped from images and videos.
- Avatar face can drift between the 3 UGC clips; frames 2–3 are generated from frame 1 to reduce this.
