import { writeFile } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import type { InputImage } from "@/lib/ai/client";
import { generateImage } from "@/lib/ai/image";
import { generateSpeech } from "@/lib/ai/tts";
import { generateVideoClip } from "@/lib/ai/video";
import { db, schema } from "@/lib/db";
import type { Angle, Asset, AssetMeta, Product, VeoOperations } from "@/lib/db/schema";
import { toPng } from "@/lib/images";
import { recordCost } from "@/lib/pricing";
import { describeError } from "@/lib/retry";
import type { AssetJob } from "@/lib/queue";
import {
  ensureStoredFile,
  ensureStoredPath,
  prepareAbsolutePath,
  removeDir,
  storagePaths,
} from "@/lib/storage";

/** Thrown when an asset was deleted or reset while its job was running. */
export class CancelledError extends Error {
  constructor(assetId: string) {
    super(`Asset ${assetId} was deleted or reset; stopping before spending more`);
    this.name = "CancelledError";
  }
}

export interface AssetOutput {
  filePath: string;
  meta: AssetMeta;
}

type ImageArgs = Parameters<typeof generateImage>[0];

/**
 * Everything a generation job needs. All paid calls go through the `paid*`
 * helpers, which (1) stop if the asset is gone, (2) reuse a saved result from
 * an earlier attempt instead of paying again, and (3) record the cost.
 */
export interface AssetJobContext {
  asset: Asset;
  angle: Angle;
  product: Product & { brand: NonNullable<Product["brand"]> };
  /** Storage-relative folder for this asset's saved (paid) files and outputs. */
  dir: string;
  /** Absolute scratch folder for derived, free-to-recreate files. Deleted after the job. */
  workDir: string;
  /** True when the user asked for brand-new creative. */
  fresh: boolean;
  checkpoint(): Promise<void>;
  paidImage(relPath: string, operation: string, args: ImageArgs): Promise<InputImage>;
  paidSpeech(relPath: string, args: Parameters<typeof generateSpeech>[0]): Promise<string>;
  paidVeoClip(
    fileName: string,
    args: { prompt: string; firstFrame: InputImage; operation: string },
  ): Promise<string>;
}

async function loadContext(job: AssetJob) {
  const asset = await db().query.assets.findFirst({ where: eq(schema.assets.id, job.assetId) });
  if (!asset) return null;
  const [angle, product] = await Promise.all([
    db().query.angles.findFirst({ where: eq(schema.angles.id, asset.angleId) }),
    db().query.products.findFirst({ where: eq(schema.products.id, asset.productId) }),
  ]);
  if (!angle || !product) return null;
  if (!product.brand) throw new Error("Product has no brand profile yet");
  if (product.images.length === 0) throw new Error("Product has no images");
  return { asset, angle, product: { ...product, brand: product.brand } };
}

function buildContext(
  base: NonNullable<Awaited<ReturnType<typeof loadContext>>>,
  job: AssetJob,
  workDir: string,
): AssetJobContext {
  const { asset, product } = base;
  const assetId = asset.id;
  const dir = storagePaths.assetDir(product.id, assetId);
  const operations: VeoOperations = { ...asset.operations };

  const checkpoint = async () => {
    const [row] = await db()
      .select({ status: schema.assets.status })
      .from(schema.assets)
      .where(eq(schema.assets.id, assetId));
    if (row?.status !== "running") throw new CancelledError(assetId);
  };

  const saveOperation = async (key: string, value: VeoOperations[string]) => {
    operations[key] = value;
    // Atomic merge: parallel clips of the same asset each add their own key.
    await db()
      .update(schema.assets)
      .set({ operations: sql`${schema.assets.operations} || ${JSON.stringify({ [key]: value })}::jsonb` })
      .where(eq(schema.assets.id, assetId));
  };

  const cost = (operation: string, model: string, quantity: number, unit: string, costUsd: number) =>
    recordCost({ productId: product.id, assetId, operation, model, quantity, unit, costUsd });

  return {
    ...base,
    dir,
    workDir,
    fresh: job.fresh ?? false,
    checkpoint,

    async paidImage(relPath, operation, args) {
      const { data } = await ensureStoredFile(relPath, async () => {
        await checkpoint();
        const img = await generateImage(args);
        await cost(operation, img.model, 1, `image_${img.size}`, img.costUsd);
        return toPng(img.data);
      });
      return { data, mimeType: "image/png" };
    },

    async paidSpeech(relPath, args) {
      const { absPath } = await ensureStoredPath(relPath, async (tmp) => {
        await checkpoint();
        const speech = await generateSpeech(args);
        await cost("voiceover", speech.model, args.text.length, "characters", speech.costUsd);
        await writeFile(tmp, speech.wav);
      });
      return absPath;
    },

    async paidVeoClip(fileName, args) {
      const { absPath } = await ensureStoredPath(`${dir}/${fileName}`, async (tmp) => {
        await checkpoint();
        const previous = operations[fileName];
        const clip = await generateVideoClip({
          prompt: args.prompt,
          firstFrame: args.firstFrame,
          outputPath: tmp,
          resumeOperation: previous?.name,
          onStarted: (name) => saveOperation(fileName, { name, costRecorded: false }),
        });
        // A resumed clip whose cost was already logged must not be logged twice.
        const alreadyRecorded = previous?.costRecorded && previous.name === clip.operationName;
        if (!alreadyRecorded) {
          await cost(args.operation, clip.model, clip.seconds, "video_seconds", clip.costUsd);
          await saveOperation(fileName, { name: clip.operationName, costRecorded: true });
        }
      });
      return absPath;
    },
  };
}

function errorMessage(err: unknown): string {
  return describeError(err).slice(0, 2000);
}

/**
 * Runs one asset generation and keeps its status in sync. Failures are stored
 * on the asset (shown in the UI) instead of being retried automatically;
 * a manual Retry reuses every paid part that already finished.
 */
export async function runAssetJob(
  job: AssetJob,
  label: string,
  generate: (ctx: AssetJobContext) => Promise<AssetOutput>,
): Promise<void> {
  const { assetId } = job;
  const started = Date.now();
  // Only update a row that is still ours (not deleted or re-queued meanwhile).
  const update = (values: Partial<typeof schema.assets.$inferInsert>, onlyIfStatus: Asset["status"]) =>
    db()
      .update(schema.assets)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(schema.assets.id, assetId), eq(schema.assets.status, onlyIfStatus)))
      .returning({ id: schema.assets.id });

  let tmpDir: string | null = null;
  try {
    const base = await loadContext(job);
    if (!base) {
      console.warn(`[${label}] asset ${assetId} no longer exists, skipping`);
      return;
    }
    const claimed = await update({ status: "running", error: null }, "queued");
    if (claimed.length === 0) {
      console.warn(`[${label}] asset ${assetId} is not queued any more, skipping`);
      return;
    }
    tmpDir = storagePaths.tmpDir(base.product.id, assetId);
    const workDir = (await prepareAbsolutePath(`${tmpDir}/.keep`)).replace(/\/\.keep$/, "");

    const output = await generate(buildContext(base, job, workDir));
    await update({ status: "done", filePath: output.filePath, meta: output.meta }, "running");
    console.log(`[${label}] asset ${assetId} done in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  } catch (err) {
    if (err instanceof CancelledError) {
      console.warn(`[${label}] ${err.message}`);
      return;
    }
    console.error(`[${label}] asset ${assetId} failed:`, err);
    await update({ status: "failed", error: errorMessage(err) }, "running");
  } finally {
    if (tmpDir) await removeDir(tmpDir).catch(() => {});
  }
}

export { errorMessage };
