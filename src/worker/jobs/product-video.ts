import { writeFile } from "node:fs/promises";
import path from "node:path";
import { loadPng } from "@/lib/images";
import { mapSettled } from "@/lib/limit";
import { chunkText, timeCaptions } from "@/lib/media/captions";
import { env } from "@/lib/env";
import { concatClips, mixVoiceover, normalizeClip, probe, stillToMotionClip } from "@/lib/media/ffmpeg";
import type { AssetJob } from "@/lib/queue";
import { absolutePath, prepareAbsolutePath } from "@/lib/storage";
import { runAssetJob } from "./shared";
import { finishVideo, videoSize } from "./video-assembly";

const VOICEOVER_DELAY_SECONDS = 0.4;
const AMBIENCE_VOLUME = 0.25;
/** Length of a free animated-still shot (used instead of a second Veo clip). */
const STILL_SHOT_SECONDS = 4;

/**
 * Product motion video (~12s + end card):
 * 2 hero stills -> shot 1 animated by Veo (paid), shot 2 a slow zoom on the
 * still (free, unless PRODUCT_VIDEO_VEO_CLIPS=2) -> voiceover -> captions -> end card.
 * Stills, clips and voiceover are saved, so Retry/Re-render only pays for
 * what is missing.
 */
export function productVideoJob(job: AssetJob): Promise<void> {
  return runAssetJob(job, "product-video", async (ctx) => {
    const { angle, product, dir, workDir } = ctx;
    const { brand } = product;
    const productPhoto = await loadPng(product.images[0]);
    const size = videoSize();
    const veoClips = env().PRODUCT_VIDEO_VEO_CLIPS;

    // Shots and voiceover run in parallel. Everything is awaited before an
    // error is raised, so finished (paid) parts are saved for the retry.
    const [shotsResult, voiceResult] = await Promise.allSettled([
      mapSettled(angle.productShots, 2, async (shot, i) => {
        const still = await ctx.paidImage(`${dir}/still-${i}.png`, "product_still", {
          aspectRatio: "9:16",
          references: [productPhoto],
          prompt: `Photorealistic vertical product commercial frame of ${brand.productName} (${brand.category}).
Scene: ${shot.scene}
Photography style: ${brand.visualStyle}
The product must look exactly like the reference image: same shape, colors, label and text.
No added text, logos or watermarks. No visible human faces.`,
        });
        const normalized = path.join(workDir, `shot-${i}-norm.mp4`);
        if (i >= veoClips) {
          const stillPath = path.join(workDir, `still-${i}.png`);
          await writeFile(stillPath, still.data);
          await stillToMotionClip(stillPath, normalized, STILL_SHOT_SECONDS, size);
          return normalized;
        }
        const raw = await ctx.paidVeoClip(`shot-${i}.mp4`, {
          operation: "product_clip",
          firstFrame: still,
          prompt: `${shot.motion}. Premium product commercial, smooth stabilized camera movement.
The product stays exactly as shown, with its label and packaging unchanged.
Do not add any new objects, price tags, signs, graphics, logos or text. No people, no dialogue.
Subtle ambient sound only, no music.`,
        });
        await normalizeClip(raw, normalized, size);
        return normalized;
      }),
      ctx.paidSpeech(`${dir}/voiceover.wav`, {
        text: angle.voiceover,
        style: `${brand.tone}; upbeat social media ad read, clear and natural`,
      }),
    ]);
    if (shotsResult.status === "rejected") throw shotsResult.reason;
    if (voiceResult.status === "rejected") throw voiceResult.reason;
    const clips = shotsResult.value;
    const voiceover = voiceResult.value;

    // Join shots and lay the voiceover over the ambience (free, FFmpeg only).
    const joined = path.join(workDir, "joined.mp4");
    await concatClips(clips, joined);
    const mixed = path.join(workDir, "mixed.mp4");
    await mixVoiceover(joined, voiceover, mixed, {
      delaySeconds: VOICEOVER_DELAY_SECONDS,
      bedVolume: AMBIENCE_VOLUME,
    });

    // Captions follow the voiceover, clipped to the video length.
    const [{ durationSeconds: voDuration }, { durationSeconds: bodyDuration }] = await Promise.all([
      probe(voiceover),
      probe(mixed),
    ]);
    const spoken = Math.min(voDuration, bodyDuration - VOICEOVER_DELAY_SECONDS);
    const cues = timeCaptions(chunkText(angle.voiceover), VOICEOVER_DELAY_SECONDS, spoken);

    const filePath = `${dir}/video.mp4`;
    const posterPath = `${dir}/poster.jpg`;
    const result = await finishVideo({
      body: mixed,
      cues,
      brand,
      headline: angle.headline,
      cta: angle.cta,
      productImagePath: product.images[0],
      workDir,
      output: await prepareAbsolutePath(filePath),
      poster: absolutePath(posterPath),
    });

    return { filePath, meta: { ...result, posterPath } };
  });
}
