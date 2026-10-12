import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

/**
 * Local file storage. Paths stored in the database are relative to
 * STORAGE_DIR (forward slashes), so moving to S3 later only touches this file.
 */

export function absolutePath(relPath: string): string {
  const root = env().storageRoot;
  const abs = path.resolve(root, relPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`Path escapes storage root: ${relPath}`);
  }
  return abs;
}

export async function saveFile(
  relPath: string,
  data: Buffer | Uint8Array,
): Promise<string> {
  const abs = absolutePath(relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
  return relPath;
}

export async function readStoredFile(relPath: string): Promise<Buffer> {
  return readFile(absolutePath(relPath));
}

export async function fileExists(relPath: string): Promise<boolean> {
  try {
    await stat(absolutePath(relPath));
    return true;
  } catch {
    return false;
  }
}

/** Ensures the parent directory exists and returns the absolute path. */
export async function prepareAbsolutePath(relPath: string): Promise<string> {
  const abs = absolutePath(relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  return abs;
}

/**
 * Returns the stored file at `relPath`, producing it only if it doesn't exist
 * yet. Used for every paid AI output so a retry never pays for it twice.
 * The producer writes to a temporary path that is renamed into place, so a
 * crash can never leave a half-written file that would later be reused.
 */
export async function ensureStoredPath(
  relPath: string,
  produce: (tmpAbsPath: string) => Promise<void>,
): Promise<{ absPath: string; reused: boolean }> {
  const absPath = absolutePath(relPath);
  if (await fileExists(relPath)) return { absPath, reused: true };
  await mkdir(path.dirname(absPath), { recursive: true });
  const ext = path.extname(absPath);
  const tmp = `${absPath.slice(0, absPath.length - ext.length)}.partial${ext}`;
  await rm(tmp, { force: true });
  await produce(tmp);
  await rename(tmp, absPath);
  return { absPath, reused: false };
}

/** Buffer variant of ensureStoredPath. */
export async function ensureStoredFile(
  relPath: string,
  produce: () => Promise<Buffer>,
): Promise<{ data: Buffer; reused: boolean }> {
  const { absPath, reused } = await ensureStoredPath(relPath, async (tmp) => {
    await writeFile(tmp, await produce());
  });
  return { data: await readFile(absPath), reused };
}

export async function removeDir(relPath: string): Promise<void> {
  await rm(absolutePath(relPath), { recursive: true, force: true });
}

export const storagePaths = {
  productImage: (productId: string, index: number) =>
    `products/${productId}/source/${index}.png`,
  assetDir: (productId: string, assetId: string) =>
    `products/${productId}/assets/${assetId}`,
  /** Scene shared by the 1:1, 4:5 and 9:16 static ads of one angle. */
  sharedScene: (productId: string, angleId: string) =>
    `products/${productId}/angles/${angleId}/scene.png`,
  tmpDir: (productId: string, assetId: string) =>
    `products/${productId}/tmp/${assetId}`,
};

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
};

export function mimeTypeFor(relPath: string): string {
  return MIME_TYPES[path.extname(relPath).toLowerCase()] ?? "application/octet-stream";
}
