import { and, eq, max, notExists } from "drizzle-orm";
import { analyzeProduct, generateAngles } from "@/lib/ai/copy";
import { db, schema } from "@/lib/db";
import { loadPng, normalizeProductImage } from "@/lib/images";
import { recordCost } from "@/lib/pricing";
import { downloadImage, scrapeProductPage } from "@/lib/scrape";
import { saveFile, storagePaths } from "@/lib/storage";
import { errorMessage } from "./shared";

const ANGLE_COUNT = 6;
const MAX_SCRAPED_IMAGES = 3;

/**
 * Builds the brand profile and ad angles for a product:
 * scrape URL (optional) -> collect photos -> Gemini brand analysis -> angles.
 */
export async function analyzeProductJob(productId: string): Promise<void> {
  const product = await db().query.products.findFirst({
    where: eq(schema.products.id, productId),
  });
  if (!product) return;

  try {
    let pageText: string | null = null;
    let images = product.images;

    if (product.sourceUrl) {
      const page = await scrapeProductPage(product.sourceUrl);
      pageText = page.text;

      if (images.length === 0) {
        const downloaded: string[] = [];
        for (const url of page.imageUrls) {
          if (downloaded.length >= MAX_SCRAPED_IMAGES) break;
          try {
            const png = await normalizeProductImage(await downloadImage(url));
            downloaded.push(await saveFile(storagePaths.productImage(productId, downloaded.length), png));
          } catch (err) {
            console.warn(`[analyze] skipping image ${url}: ${errorMessage(err)}`);
          }
        }
        images = downloaded;
        await db().update(schema.products).set({ images }).where(eq(schema.products.id, productId));
      }
    }

    if (images.length === 0) {
      throw new Error(
        "No product photo found. Upload at least one product image and try again.",
      );
    }

    const photos = await Promise.all(images.map(loadPng));

    const analysis = await analyzeProduct({
      name: product.name,
      description: product.description,
      pageText,
      images: photos,
    });
    await recordCost({
      productId,
      operation: "brand_analysis",
      model: analysis.model,
      quantity: analysis.usage.inputTokens + analysis.usage.outputTokens,
      unit: "tokens",
      costUsd: analysis.costUsd,
    });

    const generated = await generateAngles({
      brand: analysis.data,
      count: ANGLE_COUNT,
      images: photos,
    });
    await recordCost({
      productId,
      operation: "angles",
      model: generated.model,
      quantity: generated.usage.inputTokens + generated.usage.outputTokens,
      unit: "tokens",
      costUsd: generated.costUsd,
    });

    await db().transaction(async (tx) => {
      // Replace only angles nothing was generated from. Angles with assets
      // (already paid for) are kept, and the new angles are added after them.
      await tx
        .delete(schema.angles)
        .where(
          and(
            eq(schema.angles.productId, productId),
            notExists(
              tx
                .select({ id: schema.assets.id })
                .from(schema.assets)
                .where(eq(schema.assets.angleId, schema.angles.id)),
            ),
          ),
        );
      const [{ last }] = await tx
        .select({ last: max(schema.angles.position) })
        .from(schema.angles)
        .where(eq(schema.angles.productId, productId));
      const start = last === null ? 0 : last + 1;
      await tx.insert(schema.angles).values(
        generated.data.angles.map((a, i) => ({ ...a, productId, position: start + i })),
      );
      await tx
        .update(schema.products)
        .set({ brand: analysis.data, status: "ready", error: null })
        .where(eq(schema.products.id, productId));
    });
  } catch (err) {
    console.error(`[analyze] product ${productId} failed:`, err);
    await db()
      .update(schema.products)
      .set({ status: "failed", error: errorMessage(err) })
      .where(eq(schema.products.id, productId));
  }
}
