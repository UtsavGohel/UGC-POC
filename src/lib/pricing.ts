import { db, schema } from "@/lib/db";
import type { Asset } from "@/lib/db/schema";
import { env } from "@/lib/env";

/**
 * Published prices (USD) from https://ai.google.dev/gemini-api/docs/pricing,
 * checked 2026-10-12. Gemini 3.8 Flash and Flash TTS prices are introductory
 * rates that double on 2027-01-01 — update them here when that happens.
 */
export const PRICES = {
  text: {
    "gemini-3.8-flash": { inputPerM: 0.75, outputPerM: 3.75 },
  } as Record<string, { inputPerM: number; outputPerM: number }>,
  image: {
    "gemini-nano-banana-2.1": { "1K": 0.0336, "2K": 0.0504, "4K": 0.113 },
  } as Record<string, Record<"1K" | "2K" | "4K", number>>,
  tts: {
    "gemini-3.8-flash-tts": { inputPerM: 0.5, outputPerM: 9.0 },
  } as Record<string, { inputPerM: number; outputPerM: number }>,
  video: {
    "veo-3.1-lite-generate-preview": { "720p": 0.05, "1080p": 0.08 },
  } as Record<string, Record<"720p" | "1080p", number>>,
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export function textCost(model: string, usage: TokenUsage): number {
  const p = PRICES.text[model];
  if (!p) return 0;
  return (usage.inputTokens * p.inputPerM + usage.outputTokens * p.outputPerM) / 1e6;
}

export function ttsCost(model: string, usage: TokenUsage): number {
  const p = PRICES.tts[model];
  if (!p) return 0;
  return (usage.inputTokens * p.inputPerM + usage.outputTokens * p.outputPerM) / 1e6;
}

export function imageCost(model: string, size: "1K" | "2K" | "4K"): number {
  return PRICES.image[model]?.[size] ?? 0;
}

export function videoCost(
  model: string,
  resolution: "720p" | "1080p",
  seconds: number,
): number {
  return (PRICES.video[model]?.[resolution] ?? 0) * seconds;
}

export interface CostEventInput {
  productId: string;
  assetId?: string | null;
  operation: string;
  model: string;
  quantity: number;
  unit: string;
  costUsd: number;
}

export async function recordCost(event: CostEventInput): Promise<void> {
  await db().insert(schema.costEvents).values({
    ...event,
    assetId: event.assetId ?? null,
  });
}

/**
 * Refuses to run with a model that has no price configured; otherwise its
 * spend would be logged as $0 and the cost table would under-report.
 */
export function assertModelsPriced(): void {
  const e = env();
  const missing = [
    !PRICES.text[e.GEMINI_TEXT_MODEL] && `GEMINI_TEXT_MODEL=${e.GEMINI_TEXT_MODEL}`,
    !PRICES.image[e.GEMINI_IMAGE_MODEL] && `GEMINI_IMAGE_MODEL=${e.GEMINI_IMAGE_MODEL}`,
    !PRICES.tts[e.GEMINI_TTS_MODEL] && `GEMINI_TTS_MODEL=${e.GEMINI_TTS_MODEL}`,
    !PRICES.video[e.VEO_MODEL] && `VEO_MODEL=${e.VEO_MODEL}`,
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `No price configured for: ${missing.join(", ")}. Add it to PRICES in src/lib/pricing.ts.`,
    );
  }
}

/** Expected AI spend per asset, used for the estimate and the per-click budget cap. */
export function estimateAssetCostUsd(kind: Asset["kind"]): number {
  const e = env();
  const image = imageCost(e.GEMINI_IMAGE_MODEL, "1K");
  const perSecond = videoCost(e.VEO_MODEL, e.VIDEO_RESOLUTION, 1);
  const textAndVoice = 0.005;
  switch (kind) {
    case "static_ad":
      // In shared mode one scene serves all three sizes of an angle.
      return e.STATIC_SCENE_MODE === "shared" ? image / 3 : image;
    case "product_video":
      return 2 * image + 8 * e.PRODUCT_VIDEO_VEO_CLIPS * perSecond + textAndVoice;
    case "ugc_video":
      return 3 * image + 24 * perSecond;
  }
}

/** Cost of "New image/video" for one asset (never uses the shared scene). */
export function freshAssetCostUsd(kind: Asset["kind"]): number {
  const e = env();
  return kind === "static_ad" ? imageCost(e.GEMINI_IMAGE_MODEL, "1K") : estimateAssetCostUsd(kind);
}

export type CostEstimates = Record<"normal" | "fresh", Record<Asset["kind"], number>>;

export function assetCostEstimates(): CostEstimates {
  const kinds = ["static_ad", "product_video", "ugc_video"] as const;
  const table = (fn: (k: Asset["kind"]) => number) =>
    Object.fromEntries(kinds.map((k) => [k, fn(k)])) as Record<Asset["kind"], number>;
  return { normal: table(estimateAssetCostUsd), fresh: table(freshAssetCostUsd) };
}
