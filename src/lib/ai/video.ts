import { setTimeout as sleep } from "node:timers/promises";
import { GenerateVideosOperation } from "@google/genai";
import { env } from "@/lib/env";
import { createLimiter } from "@/lib/limit";
import { videoCost } from "@/lib/pricing";
import { withRetry } from "@/lib/retry";
import { gemini, GenerationError, type InputImage } from "./client";

export interface VideoClipResult {
  costUsd: number;
  model: string;
  seconds: number;
  /** Veo operation that produced the clip. */
  operationName: string;
}

const POLL_INTERVAL_MS = 10_000;
const TIMEOUT_MS = 15 * 60_000;

// One limit for the whole worker process, shared by every job.
let veoLimiter: ReturnType<typeof createLimiter> | undefined;
function limitVeo<T>(task: () => Promise<T>): Promise<T> {
  veoLimiter ??= createLimiter(env().VEO_MAX_CONCURRENCY);
  return veoLimiter(task);
}

/** Looks up an earlier operation. Returns null when it can't be reused. */
async function loadOperation(name: string): Promise<GenerateVideosOperation | null> {
  try {
    const op = new GenerateVideosOperation();
    op.name = name;
    const loaded = await withRetry("veo resume", () => gemini().operations.getVideosOperation({ operation: op }));
    if (loaded.done && (loaded.error || !loaded.response?.generatedVideos?.[0]?.video)) return null;
    return loaded;
  } catch (err) {
    console.warn(`[veo] could not resume ${name}, starting a new clip:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Animates a first frame with Veo (image-to-video, 9:16, with native audio)
 * and downloads the clip to `outputPath`.
 *
 * Pass `resumeOperation` (from an earlier, interrupted run) to pick up a clip
 * that is already rendering or rendered instead of paying for a new one.
 * `onStarted` is called with the operation name as soon as Veo accepts the
 * request, so the caller can persist it before the long wait.
 */
export async function generateVideoClip(opts: {
  prompt: string;
  firstFrame: InputImage;
  outputPath: string;
  durationSeconds?: 4 | 6 | 8;
  resumeOperation?: string;
  onStarted?: (operationName: string) => Promise<void>;
}): Promise<VideoClipResult> {
  const { VEO_MODEL: model, VIDEO_RESOLUTION: resolution } = env();
  // Veo 3.1 Lite only renders 1080p at 8 seconds.
  const seconds = resolution === "1080p" ? 8 : (opts.durationSeconds ?? 8);
  const ai = gemini();

  let operation = opts.resumeOperation ? await loadOperation(opts.resumeOperation) : null;

  if (!operation) {
    operation = await limitVeo(async () => {
      let op = await withRetry("veo start", () =>
        ai.models.generateVideos({
          model,
          prompt: opts.prompt,
          image: {
            imageBytes: opts.firstFrame.data.toString("base64"),
            mimeType: opts.firstFrame.mimeType,
          },
          config: {
            aspectRatio: "9:16",
            durationSeconds: seconds,
            resolution,
            personGeneration: "allow_adult",
          },
        }),
      );
      if (!op.name) throw new GenerationError("Veo did not return an operation name");
      await opts.onStarted?.(op.name);
      op = await waitForOperation(op);
      return op;
    });
  } else if (!operation.done) {
    operation = await waitForOperation(operation);
  }

  if (operation.error) {
    throw new GenerationError(`Veo failed: ${JSON.stringify(operation.error)}`);
  }
  const response = operation.response;
  const video = response?.generatedVideos?.[0]?.video;
  if (!video) {
    const filtered = response?.raiMediaFilteredReasons?.join("; ");
    throw new GenerationError(
      `Veo returned no video${filtered ? ` (safety filter: ${filtered})` : ""}`,
    );
  }

  await withRetry("veo download", () => ai.files.download({ file: video, downloadPath: opts.outputPath }));

  return {
    costUsd: videoCost(model, resolution, seconds),
    model,
    seconds,
    operationName: operation.name ?? opts.resumeOperation ?? "",
  };
}

async function waitForOperation(op: GenerateVideosOperation): Promise<GenerateVideosOperation> {
  const deadline = Date.now() + TIMEOUT_MS;
  let current = op;
  while (!current.done) {
    if (Date.now() > deadline) {
      // The operation keeps running at Google; its name is saved, so a Retry resumes it.
      throw new GenerationError(
        `Veo is still rendering after ${TIMEOUT_MS / 60_000} minutes. Click Retry later to pick up the same clip (no extra cost).`,
      );
    }
    await sleep(POLL_INTERVAL_MS);
    current = await withRetry("veo poll", () => gemini().operations.getVideosOperation({ operation: current }));
  }
  return current;
}
