import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { getProductDetail } from "@/lib/data";
import { absolutePath } from "@/lib/storage";

const KIND_LABEL = {
  static_ad: "static",
  product_video: "product-video",
  ugc_video: "ugc-video",
} as const;

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";
}

/** Zips every finished asset plus a captions file, grouped by angle. */
export async function GET(_request: Request, ctx: RouteContext<"/api/products/[id]/download">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });

  const detail = await getProductDetail(id);
  if (!detail) return new Response("Not found", { status: 404 });

  const done = detail.assets.filter((a) => a.status === "done" && a.filePath);
  if (done.length === 0) return new Response("No finished assets yet", { status: 404 });

  const zip = new ZipArchive({ zlib: { level: 1 } }); // media is already compressed
  const output = new PassThrough();
  zip.on("error", (err: Error) => output.destroy(err));
  zip.pipe(output);

  for (const angle of detail.angles) {
    const folder = `${String(angle.position + 1).padStart(2, "0")}-${slug(angle.title)}`;
    const assets = done.filter((a) => a.angleId === angle.id);
    if (assets.length === 0) continue;

    zip.append(
      [
        `Angle: ${angle.title} (${angle.type})`,
        `Hook: ${angle.hook}`,
        `Headline: ${angle.headline}`,
        `CTA: ${angle.cta}`,
        "",
        "Post caption:",
        angle.caption,
      ].join("\n"),
      { name: `${folder}/caption.txt` },
    );
    for (const [i, asset] of assets.entries()) {
      const ext = asset.filePath!.split(".").pop();
      const ratio = asset.aspectRatio.replace(":", "x");
      zip.file(absolutePath(asset.filePath!), {
        name: `${folder}/${KIND_LABEL[asset.kind]}-${ratio}-${i + 1}.${ext}`,
      });
    }
  }
  void zip.finalize();

  return new Response(Readable.toWeb(output) as ReadableStream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${slug(detail.product.name)}-ads.zip"`,
    },
  });
}
