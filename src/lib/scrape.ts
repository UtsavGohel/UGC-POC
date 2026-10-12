import * as cheerio from "cheerio";

export interface ScrapedPage {
  title: string | null;
  text: string;
  imageUrls: string[];
}

const FETCH_TIMEOUT_MS = 15_000;
const MAX_TEXT_CHARS = 6_000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function assertHttpUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are supported");
  }
  return url;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      // Many shops block requests without a browser-like user agent.
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Fetching ${url} failed with HTTP ${res.status}`);
  return res;
}

/** Pulls product title, readable text and product images from a product page. */
export async function scrapeProductPage(rawUrl: string): Promise<ScrapedPage> {
  const url = assertHttpUrl(rawUrl);
  const html = await (await fetchWithTimeout(url.toString())).text();
  const $ = cheerio.load(html);

  const imageUrls = new Set<string>();
  const addImage = (src: string | undefined) => {
    if (!src) return;
    try {
      imageUrls.add(new URL(src, url).toString());
    } catch {
      /* ignore malformed URLs */
    }
  };

  // JSON-LD Product data is the most reliable source on most shops.
  const structured: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed: unknown = JSON.parse($(el).text());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes.flatMap((n) => (n?.["@graph"] as unknown[]) ?? [n])) {
        const item = node as Record<string, unknown>;
        if (item?.["@type"] !== "Product") continue;
        const offers = (Array.isArray(item.offers) ? item.offers[0] : item.offers) as
          | Record<string, unknown>
          | undefined;
        structured.push(
          [
            `Name: ${item.name ?? ""}`,
            `Description: ${item.description ?? ""}`,
            offers?.price ? `Price: ${offers.price} ${offers.priceCurrency ?? ""}` : "",
          ].join("\n"),
        );
        const images = Array.isArray(item.image) ? item.image : [item.image];
        for (const img of images) {
          addImage(typeof img === "string" ? img : (img as { url?: string })?.url);
        }
      }
    } catch {
      /* ignore invalid JSON-LD */
    }
  });

  addImage($('meta[property="og:image"]').attr("content"));

  const title =
    $('meta[property="og:title"]').attr("content") ?? $("title").first().text() ?? null;
  const metaDescription = $('meta[name="description"]').attr("content") ?? "";

  $("script, style, noscript, svg, nav, footer, header, iframe").remove();
  const bodyText = $("main").text() || $("body").text();
  const text = [structured.join("\n\n"), metaDescription, bodyText]
    .join("\n\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARS);

  return { title: title?.trim() || null, text, imageUrls: [...imageUrls].slice(0, 4) };
}

export async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetchWithTimeout(assertHttpUrl(url).toString());
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new Error(`Not an image: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error(`Image too large: ${url}`);
  return buf;
}
