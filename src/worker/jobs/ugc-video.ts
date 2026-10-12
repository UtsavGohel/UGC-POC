import path from "node:path";
import { loadPng } from "@/lib/images";
import { mapSettled } from "@/lib/limit";
import { chunkText, timeCaptions, type CaptionCue } from "@/lib/media/captions";
import { concatClips, normalizeClip, probe } from "@/lib/media/ffmpeg";
import type { AssetJob } from "@/lib/queue";
import { absolutePath, prepareAbsolutePath } from "@/lib/storage";
import { runAssetJob } from "./shared";
import { finishVideo, videoSize } from "./video-assembly";

/** Framing for lines 2 and 3; the same creator in each shot. */
const SHOT_VARIATIONS = [
  "a closer shot from a slightly different angle, holding the product near the face and looking at the camera",
  "a medium shot, smiling and pointing at the product held toward the camera",
];

/**
 * UGC avatar video (~24s + end card):
 * base frame of a creator holding the product -> 2 variation frames of the
 * same creator -> Veo animates each frame speaking one script line -> captions.
 * Frames and clips are saved, so a Retry only pays for what is missing.
 */
export function ugcVideoJob(job: AssetJob): Promise<void> {
  return runAssetJob(job, "ugc-video", async (ctx) => {
    const { angle, product, dir, workDir } = ctx;
    const { brand } = product;
    const { persona, setting, lines } = angle.ugcScript;
    const productPhoto = await loadPng(product.images[0]);
    const size = videoSize();

    // 1) Base frame: the creator holding the real product.
    const baseFrame = await ctx.paidImage(`${dir}/frame-0.png`, "ugc_base_frame", {
      aspectRatio: "9:16",
      references: [productPhoto],
      prompt: `Photorealistic vertical smartphone video frame in authentic UGC style.
Creator: ${persona}.
Location: ${setting}.
The creator holds ${brand.productName} in one hand toward the camera and looks into the lens,
mouth relaxed and slightly open as if about to speak. Natural daylight, casual and real, not a studio shoot.
The product must look exactly like the reference image: same shape, colors, label and text.
No text, captions, logos or watermarks added.`,
    });

    // 2) Variation frames reuse the base frame as a reference to keep the same person.
    const variations = await mapSettled(SHOT_VARIATIONS, 2, (variation, i) =>
      ctx.paidImage(`${dir}/frame-${i + 1}.png`, "ugc_variation_frame", {
        aspectRatio: "9:16",
        references: [baseFrame, productPhoto],
        prompt: `Using the first reference image, show the exact same person, same face, hair, outfit and
location, now in ${variation}. Keep the product identical to the second reference image.
Photorealistic smartphone UGC frame. No text, captions, logos or watermarks.`,
      }),
    );
    const frames = [baseFrame, ...variations];

    // 3) One talking clip per line. All clips finish before any error is raised,
    //    so a retry only re-renders the clip that failed.
    const clips = await mapSettled(lines, 3, async (line, i) => {
      const raw = await ctx.paidVeoClip(`line-${i}.mp4`, {
        operation: "ugc_clip",
        firstFrame: frames[i],
        prompt: `Vertical UGC-style smartphone video. The person in the frame talks directly to the camera
in a natural, friendly, enthusiastic tone and says: "${line.replace(/"/g, "'")}"
Handheld phone with slight natural movement, natural room ambience.
No background music, no subtitles, no text on screen. The product stays exactly as shown.
Do not add any new objects, price tags, signs, graphics or logos.`,
      });
      const normalized = path.join(workDir, `line-${i}-norm.mp4`);
      await normalizeClip(raw, normalized, size);
      return normalized;
    });

    const body = path.join(workDir, "joined.mp4");
    await concatClips(clips, body);

    // 4) Captions: each line spread over its own clip, leaving a short lead-in and tail.
    const cues: CaptionCue[] = [];
    let offset = 0;
    for (const [i, clip] of clips.entries()) {
      const { durationSeconds } = await probe(clip);
      cues.push(...timeCaptions(chunkText(lines[i]), offset + 0.3, Math.max(1, durationSeconds - 0.8)));
      offset += durationSeconds;
    }

    const filePath = `${dir}/video.mp4`;
    const posterPath = `${dir}/poster.jpg`;
    const result = await finishVideo({
      body,
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
