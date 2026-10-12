import { env } from "@/lib/env";
import { imageCost } from "@/lib/pricing";
import { withRetry } from "@/lib/retry";
import { gemini, GenerationError, imagePart, textPart, type InputImage } from "./client";

export type ImageAspectRatio = "1:1" | "4:5" | "9:16" | "16:9";
export type ImageSize = "1K" | "2K";

export interface ImageResult {
  data: Buffer;
  mimeType: string;
  costUsd: number;
  model: string;
  size: ImageSize;
}

/**
 * Generates an image with Nano Banana. Reference images (the product photo,
 * an earlier frame) are passed alongside the prompt so the model edits around
 * them instead of re-inventing the product.
 */
export async function generateImage(opts: {
  prompt: string;
  references: InputImage[];
  aspectRatio: ImageAspectRatio;
  size?: ImageSize;
}): Promise<ImageResult> {
  const model = env().GEMINI_IMAGE_MODEL;
  const size = opts.size ?? "1K";

  const interaction = await withRetry("nano banana", () =>
    gemini().interactions.create({
      model,
      input: [textPart(opts.prompt), ...opts.references.map(imagePart)],
      response_format: {
        type: "image",
        aspect_ratio: opts.aspectRatio,
        image_size: size,
      },
    }),
  );

  const image = interaction.output_image;
  if (!image?.data) {
    const reason = interaction.output_text?.trim();
    throw new GenerationError(
      `Image model returned no image${reason ? `: ${reason.slice(0, 300)}` : ""}`,
    );
  }

  return {
    data: Buffer.from(image.data, "base64"),
    mimeType: image.mime_type ?? "image/png",
    costUsd: imageCost(model, size),
    model,
    size,
  };
}
