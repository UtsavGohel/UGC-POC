import sharp from "sharp";
import type { InputImage } from "@/lib/ai/client";
import { readStoredFile } from "@/lib/storage";

const MAX_SIDE = 1536;

/** Converts any supported upload to a PNG no larger than 1536px on its longest side. */
export async function normalizeProductImage(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: "error" })
    .rotate() // respect EXIF orientation
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
}

export async function loadPng(relPath: string): Promise<InputImage> {
  return { data: await readStoredFile(relPath), mimeType: "image/png" };
}

/** Re-encodes model output as PNG so every stored image has one format. */
export async function toPng(data: Buffer): Promise<Buffer> {
  return sharp(data).png().toBuffer();
}

/** Cover-crops an image to exact pixel dimensions. */
export async function coverResize(data: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(data).resize(width, height, { fit: "cover", position: "attention" }).png().toBuffer();
}
