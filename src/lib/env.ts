import path from "node:path";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  STORAGE_DIR: z.string().default("./storage"),
  GEMINI_TEXT_MODEL: z.string().default("gemini-3.8-flash"),
  GEMINI_IMAGE_MODEL: z.string().default("gemini-nano-banana-2.1"),
  GEMINI_TTS_MODEL: z.string().default("gemini-3.8-flash-tts"),
  VEO_MODEL: z.string().default("veo-3.1-lite-generate-preview"),
  VIDEO_RESOLUTION: z.enum(["720p", "1080p"]).default("720p"),
  /** "shared": one AI scene per angle, cropped to 1:1/4:5/9:16 (1/3 the cost). "per_ratio": one scene per size. */
  STATIC_SCENE_MODE: z.enum(["shared", "per_ratio"]).default("shared"),
  /** Max Veo generations running at once in the worker (avoids 429s). */
  VEO_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  /** Largest estimated spend a single "Generate" click may queue. */
  MAX_BATCH_USD: z.coerce.number().positive().default(2),
  /** Paid Veo shots per product video: 1 (second shot is a free animated still) or 2. */
  PRODUCT_VIDEO_VEO_CLIPS: z.coerce.number().int().min(1).max(2).default(1),
  /** How often idle workers check the queue (LISTEN/NOTIFY wakes them sooner). */
  WORKER_POLL_SECONDS: z.coerce.number().min(1).default(15),
});

export type Env = z.infer<typeof schema> & { storageRoot: string };

let cached: Env | undefined;

/** Validated environment. Parsed lazily so `next build` works without secrets. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = {
    ...parsed.data,
    // Runtime-configured directory; keep Turbopack from tracing it into the build.
    storageRoot: path.resolve(/*turbopackIgnore: true*/ process.cwd(), parsed.data.STORAGE_DIR),
  };
  return cached;
}
