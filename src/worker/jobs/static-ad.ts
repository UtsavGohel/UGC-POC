import { env } from "@/lib/env";
import { coverResize, loadPng } from "@/lib/images";
import { withKeyLock } from "@/lib/limit";
import type { AssetJob } from "@/lib/queue";
import { renderStaticAd, STATIC_AD_SIZES } from "@/lib/render/templates";
import { ensureStoredFile, saveFile, storagePaths } from "@/lib/storage";
import { runAssetJob } from "./shared";

/**
 * Static ad = AI scene around the real product + headline/CTA rendered in code.
 *
 * Cost control:
 * - The rendered scene is saved per asset, so "Re-render" (after a brand or
 *   text change) only redraws the text and costs nothing.
 * - In "shared" scene mode the three sizes of an angle share ONE generated
 *   scene (cropped per size) instead of paying for three.
 */
export function staticAdJob(job: AssetJob): Promise<void> {
  return runAssetJob(job, "static-ad", async (ctx) => {
    const { asset, angle, product, dir } = ctx;
    const { brand } = product;
    const size = STATIC_AD_SIZES[asset.aspectRatio];
    const productPhoto = await loadPng(product.images[0]);
    const shared = env().STATIC_SCENE_MODE === "shared" && !ctx.fresh;

    const prompt = `Create a photorealistic advertising photo for ${brand.productName} (${brand.category}).
Scene: ${angle.sceneIdea}
Photography style: ${brand.visualStyle}
Requirements:
- The product must look exactly like the product in the reference image: same shape, colors, label and printed text.
- The product is the clear hero: sharp, well lit, centered horizontally in the upper half of the frame${
      shared ? ", with generous space on every side so the photo can be cropped to square and tall vertical formats" : ""
    }.
- Keep the bottom third of the frame calm and uncluttered; ad text will be placed there.
- Do not add any text, logos, watermarks, captions or borders.
- No visible human faces.`;

    const scenePath = `${dir}/scene.png`;
    const { data: scenePng } = await ensureStoredFile(scenePath, async () => {
      if (!shared) {
        const img = await ctx.paidImage(`${dir}/scene-source.png`, "static_scene", {
          aspectRatio: asset.aspectRatio,
          references: [productPhoto],
          prompt,
        });
        return coverResize(img.data, size.width, size.height);
      }
      // The lock makes the 3 sibling jobs wait for one generation instead of each
      // paying (the app runs a single worker process).
      const source = await withKeyLock(`scene:${angle.id}`, () =>
        ctx.paidImage(storagePaths.sharedScene(product.id, angle.id), "static_scene_shared", {
          aspectRatio: "4:5",
          references: [productPhoto],
          prompt,
        }),
      );
      return coverResize(source.data, size.width, size.height);
    });

    const adPng = await renderStaticAd({
      scenePng,
      aspectRatio: asset.aspectRatio,
      brandName: brand.brandName,
      headline: angle.headline,
      subheadline: angle.subheadline,
      cta: angle.cta,
      colors: brand.colors,
    });
    const filePath = await saveFile(`${dir}/ad.png`, adPng);

    return { filePath, meta: { width: size.width, height: size.height, scenePath } };
  });
}
