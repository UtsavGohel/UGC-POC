import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { absolutePath, mimeTypeFor } from "@/lib/storage";

/**
 * Serves stored media. Supports HTTP Range requests, which browsers need to
 * seek in <video> (Safari won't play video at all without them).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/files/[...path]">) {
  const { path: segments } = await ctx.params;
  const relPath = segments.map(decodeURIComponent).join("/");

  let abs: string;
  let size: number;
  try {
    abs = absolutePath(relPath);
    const info = await stat(abs);
    if (!info.isFile()) throw new Error("not a file");
    size = info.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const download = new URL(request.url).searchParams.has("download");
  const headers = new Headers({
    "content-type": mimeTypeFor(relPath),
    "accept-ranges": "bytes",
    "cache-control": "no-cache",
  });
  if (download) {
    headers.set("content-disposition", `attachment; filename="${segments.at(-2) ?? "file"}-${segments.at(-1)}"`);
  }

  const range = request.headers.get("range");
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (match && (match[1] || match[2])) {
    let start: number;
    let end: number;
    if (match[1]) {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    } else {
      // suffix range: last N bytes
      start = Math.max(0, size - Number(match[2]));
      end = size - 1;
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    }
    headers.set("content-range", `bytes ${start}-${end}/${size}`);
    headers.set("content-length", String(end - start + 1));
    const stream = Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers });
  }

  headers.set("content-length", String(size));
  return new Response(Readable.toWeb(createReadStream(abs)) as ReadableStream, { headers });
}
