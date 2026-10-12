import { writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import type { BrandProfile } from "@/lib/db/schema";
import type { CaptionCue } from "@/lib/media/captions";
import {
  burnOverlays,
  concatClips,
  imageToClip,
  posterFrame,
  probe,
  type TimedOverlay,
} from "@/lib/media/ffmpeg";
import { readStoredFile } from "@/lib/storage";
import { renderCaption, renderEndCard } from "@/lib/render/templates";

export const END_CARD_SECONDS = 2.5;

export function videoSize(): { width: number; height: number } {
  return env().VIDEO_RESOLUTION === "1080p"
    ? { width: 1080, height: 1920 }
    : { width: 720, height: 1280 };
}

/**
 * Final steps shared by both video types:
 * burn captions -> append branded end card -> write poster frame.
 * `body` must already be a normalized MP4 at videoSize().
 */
export async function finishVideo(opts: {
  body: string;
  cues: CaptionCue[];
  brand: BrandProfile;
  headline: string;
  cta: string;
  productImagePath: string;
  workDir: string;
  output: string;
  poster: string;
}): Promise<{ durationSeconds: number; width: number; height: number }> {
  const size = videoSize();
  const { workDir } = opts;

  const overlays: TimedOverlay[] = [];
  for (const [i, cue] of opts.cues.entries()) {
    const png = path.join(workDir, `caption-${i}.png`);
    await writeFile(png, await renderCaption({ text: cue.text, ...size }));
    overlays.push({ png, start: cue.start, end: cue.end });
  }
  const captioned = path.join(workDir, "captioned.mp4");
  await burnOverlays(opts.body, overlays, captioned);

  const endCardPng = path.join(workDir, "end-card.png");
  await writeFile(
    endCardPng,
    await renderEndCard({
      productPng: await readStoredFile(opts.productImagePath),
      brandName: opts.brand.brandName,
      headline: opts.headline,
      cta: opts.cta,
      colors: opts.brand.colors,
      ...size,
    }),
  );
  const endCard = path.join(workDir, "end-card.mp4");
  await imageToClip(endCardPng, endCard, END_CARD_SECONDS);

  await concatClips([captioned, endCard], opts.output);
  await posterFrame(opts.output, opts.poster);

  const { durationSeconds } = await probe(opts.output);
  return { durationSeconds, ...size };
}
