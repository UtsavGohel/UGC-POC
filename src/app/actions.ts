"use server";

import { and, eq, gte, inArray, lt, or } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import type { Asset, AspectRatio } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { normalizeProductImage } from "@/lib/images";
import { estimateAssetCostUsd, freshAssetCostUsd } from "@/lib/pricing";
import { enqueue, QUEUES, type QueueName } from "@/lib/queue";
import { removeDir, saveFile, storagePaths } from "@/lib/storage";

/*
 * Server Actions. This is a local single-user POC, so there is no auth here.
 * Add an auth check to every action before exposing the app beyond localhost.
 */

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const STATIC_AD_RATIOS: AspectRatio[] = ["1:1", "4:5", "9:16"];
/** A job that has been "running" longer than this is assumed dead (worker crash). */
const STALE_AFTER_MS = 45 * 60_000;

const QUEUE_FOR_KIND: Record<Asset["kind"], QueueName> = {
  static_ad: QUEUES.staticAd,
  product_video: QUEUES.productVideo,
  ugc_video: QUEUES.ugcVideo,
};

export interface FormState {
  error?: string;
  message?: string;
}

const uuid = z.string().uuid();

/** Assets that are finished, failed, or stuck long enough to be considered dead. */
function settledOrStale() {
  return or(
    inArray(schema.assets.status, ["done", "failed"]),
    lt(schema.assets.updatedAt, new Date(Date.now() - STALE_AFTER_MS)),
  );
}

/** True while a product has generations in flight (stale/dead ones excluded). */
async function hasActiveAssets(productId: string): Promise<boolean> {
  const rows = await db()
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.productId, productId),
        inArray(schema.assets.status, ["queued", "running"]),
        gte(schema.assets.updatedAt, new Date(Date.now() - STALE_AFTER_MS)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ---------------------------------------------------------------- products

const createProductSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(120),
  url: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => v || null)
    .refine((v) => v === null || /^https?:\/\/.+/i.test(v), "URL must start with http:// or https://"),
  description: z
    .string()
    .trim()
    .max(4000)
    .transform((v) => v || null),
});

export async function createProduct(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = createProductSchema.safeParse({
    name: formData.get("name") ?? "",
    url: formData.get("url") ?? "",
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const files = formData
    .getAll("images")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_IMAGES) return { error: `Upload at most ${MAX_IMAGES} images` };
  if (files.some((f) => !f.type.startsWith("image/"))) return { error: "Only image files are allowed" };
  if (files.some((f) => f.size > MAX_IMAGE_BYTES)) return { error: "Each image must be under 10 MB" };
  if (files.length === 0 && !parsed.data.url) {
    return { error: "Add a product URL or upload at least one product photo" };
  }

  // Decode images before touching the database so a bad file fails cleanly.
  let pngs: Buffer[];
  try {
    pngs = await Promise.all(
      files.map(async (f) => normalizeProductImage(Buffer.from(await f.arrayBuffer()))),
    );
  } catch {
    return { error: "One of the images could not be read. Try PNG, JPEG or WebP." };
  }

  const [product] = await db()
    .insert(schema.products)
    .values({
      name: parsed.data.name,
      sourceUrl: parsed.data.url,
      description: parsed.data.description,
      status: "analyzing",
    })
    .returning({ id: schema.products.id });

  const images = await Promise.all(
    pngs.map((png, i) => saveFile(storagePaths.productImage(product.id, i), png)),
  );
  await db().update(schema.products).set({ images }).where(eq(schema.products.id, product.id));
  await enqueue(QUEUES.analyzeProduct, { productId: product.id });

  redirect(`/products/${product.id}`);
}

export async function reanalyzeProduct(productId: string): Promise<FormState> {
  const id = uuid.parse(productId);
  if (await hasActiveAssets(id)) {
    return { error: "Wait for running generations to finish before re-analyzing." };
  }
  const [row] = await db()
    .update(schema.products)
    .set({ status: "analyzing", error: null })
    .where(and(eq(schema.products.id, id), inArray(schema.products.status, ["ready", "failed"])))
    .returning({ id: schema.products.id });
  if (!row) return { error: "This product is already being analyzed." };
  await enqueue(QUEUES.analyzeProduct, { productId: id });
  refresh();
  return {};
}

export async function deleteProduct(productId: string): Promise<FormState> {
  const id = uuid.parse(productId);
  // Deleting mid-generation would not stop work that is already paid for.
  if (await hasActiveAssets(id)) {
    return { error: "Wait for running generations to finish, or delete them first." };
  }
  await db().delete(schema.products).where(eq(schema.products.id, id));
  await removeDir(`products/${id}`);
  redirect("/");
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colors must be #RRGGBB");

const brandSchema = z.object({
  brandName: z.string().trim().min(1).max(80),
  productName: z.string().trim().min(1).max(120),
  oneLiner: z.string().trim().max(300),
  targetAudience: z.string().trim().max(300),
  tone: z.string().trim().max(120),
  benefits: z.string().max(2000),
  primary: hex,
  secondary: hex,
});

export async function updateBrand(
  productId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = uuid.parse(productId);
  const parsed = brandSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const product = await db().query.products.findFirst({ where: eq(schema.products.id, id) });
  if (!product?.brand) return { error: "Product has no brand profile yet" };

  const { primary, secondary, benefits, ...rest } = parsed.data;
  await db()
    .update(schema.products)
    .set({
      brand: {
        ...product.brand,
        ...rest,
        benefits: benefits.split("\n").map((b) => b.trim()).filter(Boolean),
        colors: { primary, secondary },
      },
    })
    .where(eq(schema.products.id, id));
  refresh();
  return { message: "Saved. Use “Re-render” on existing ads to apply it for free." };
}

// ------------------------------------------------------------------ assets

const generateSchema = z.object({
  angleIds: z.array(uuid).min(1, "Select at least one angle"),
  kinds: z
    .array(z.enum(["static_ad", "product_video", "ugc_video"]))
    .min(1, "Select at least one output type"),
  allowDuplicates: z.boolean(),
});

export async function generateAssets(
  productId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = uuid.parse(productId);
  const parsed = generateSchema.safeParse({
    angleIds: formData.getAll("angleIds"),
    kinds: formData.getAll("kinds"),
    allowDuplicates: formData.get("allowDuplicates") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { kinds, allowDuplicates } = parsed.data;

  const product = await db().query.products.findFirst({ where: eq(schema.products.id, id) });
  if (product?.status !== "ready") return { error: "Wait for the product analysis to finish" };

  // Only accept angles that belong to this product.
  const angles = await db()
    .select({ id: schema.angles.id })
    .from(schema.angles)
    .where(and(eq(schema.angles.productId, id), inArray(schema.angles.id, parsed.data.angleIds)));
  if (angles.length === 0) return { error: "Selected angles were not found" };

  // Skip anything already queued, running or done (double clicks, repeat
  // submits) unless the user explicitly asked for new variants.
  const existing = await db()
    .select({ angleId: schema.assets.angleId, kind: schema.assets.kind, aspectRatio: schema.assets.aspectRatio })
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.productId, id),
        inArray(schema.assets.status, ["queued", "running", "done"]),
      ),
    );
  const taken = new Set(existing.map((a) => `${a.angleId}|${a.kind}|${a.aspectRatio}`));

  const candidates = angles.flatMap((angle) =>
    kinds.flatMap((kind) =>
      (kind === "static_ad" ? STATIC_AD_RATIOS : (["9:16"] as const)).map((aspectRatio) => ({
        productId: id,
        angleId: angle.id,
        kind,
        aspectRatio,
      })),
    ),
  );
  const rows = allowDuplicates
    ? candidates
    : candidates.filter((r) => !taken.has(`${r.angleId}|${r.kind}|${r.aspectRatio}`));
  const skipped = candidates.length - rows.length;
  if (rows.length === 0) {
    return { error: "Everything selected already exists. Tick “New variants” to generate more." };
  }

  // Variants are generated fresh (no shared scene), so they cost the full price.
  const costOf = allowDuplicates ? freshAssetCostUsd : estimateAssetCostUsd;
  const estimate = rows.reduce((sum, r) => sum + costOf(r.kind), 0);
  const cap = env().MAX_BATCH_USD;
  if (estimate > cap) {
    return {
      error: `This would cost about $${estimate.toFixed(2)}, above the $${cap.toFixed(2)} limit per click (MAX_BATCH_USD). Select fewer angles or outputs.`,
    };
  }

  const created = await db()
    .insert(schema.assets)
    .values(rows)
    .returning({ id: schema.assets.id, kind: schema.assets.kind });
  // Duplicates are requested variants: generate new creative, don't reuse shared scenes.
  await Promise.all(
    created.map((a) => enqueue(QUEUE_FOR_KIND[a.kind], { assetId: a.id, fresh: allowDuplicates })),
  );

  refresh();
  return {
    message: `Queued ${created.length} item${created.length === 1 ? "" : "s"} (~$${estimate.toFixed(2)})${
      skipped ? `, skipped ${skipped} that already exist` : ""
    }.`,
  };
}

/**
 * - "reuse": keep saved scenes, clips and voiceover; only missing parts are
 *   paid for. For a finished asset this is a free re-render (new text/colors).
 * - "fresh": delete everything saved and generate new creative (paid).
 */
export async function regenerateAsset(assetId: string, mode: "reuse" | "fresh"): Promise<FormState> {
  const id = uuid.parse(assetId);
  z.enum(["reuse", "fresh"]).parse(mode);

  const [asset] = await db()
    .update(schema.assets)
    .set({
      status: "queued",
      error: null,
      updatedAt: new Date(),
      ...(mode === "fresh" ? { filePath: null, operations: {} } : {}),
    })
    // Never re-queue an asset that is still in progress (it would be paid for twice).
    .where(and(eq(schema.assets.id, id), settledOrStale()))
    .returning({ id: schema.assets.id, kind: schema.assets.kind, productId: schema.assets.productId });
  if (!asset) return { error: "This item is still being generated." };

  if (mode === "fresh") await removeDir(storagePaths.assetDir(asset.productId, asset.id));
  await enqueue(QUEUE_FOR_KIND[asset.kind], { assetId: asset.id, fresh: mode === "fresh" });
  refresh();
  return {};
}

export async function deleteAsset(assetId: string): Promise<FormState> {
  const id = uuid.parse(assetId);
  const [asset] = await db()
    .delete(schema.assets)
    .where(and(eq(schema.assets.id, id), settledOrStale()))
    .returning({ productId: schema.assets.productId });
  if (!asset) return { error: "This item is still being generated." };
  await removeDir(storagePaths.assetDir(asset.productId, id));
  refresh();
  return {};
}
