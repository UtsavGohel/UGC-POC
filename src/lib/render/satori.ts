import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";
import type { ReactNode } from "react";
import satori, { type Font } from "satori";

const require = createRequire(import.meta.url);

let fontsPromise: Promise<Font[]> | undefined;

/** Inter (latin + latin-ext) from @fontsource. Satori needs TTF/OTF/WOFF, not WOFF2. */
function loadFonts(): Promise<Font[]> {
  fontsPromise ??= Promise.all(
    ([400, 600, 800] as const).flatMap((weight) =>
      ["latin", "latin-ext"].map(async (subset) => ({
        name: "Inter",
        weight,
        style: "normal" as const,
        data: await readFile(
          require.resolve(`@fontsource/inter/files/inter-${subset}-${weight}-normal.woff`),
        ),
      })),
    ),
  );
  return fontsPromise;
}

/** Renders a JSX tree to a PNG of exactly width x height pixels. */
export async function renderPng(
  node: ReactNode,
  width: number,
  height: number,
): Promise<Buffer> {
  const svg = await satori(node, { width, height, fonts: await loadFonts() });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render();
  return png.asPng();
}

export function dataUri(png: Buffer): string {
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** Currency symbols missing from the bundled Inter subsets, spelled out instead. */
const CURRENCY_FALLBACK: Record<string, string> = {
  "₹": "Rs ",
  "₩": "KRW ",
  "₱": "PHP ",
  "₫": "VND ",
  "₦": "NGN ",
  "₺": "TRY ",
};

/**
 * Makes text safe for the bundled font: strips emoji (Satori can't draw them
 * without an extra loader) and replaces symbols the font lacks, which would
 * otherwise render as empty boxes.
 */
export function stripEmoji(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[₹₩₱₫₦₺]/g, (c) => CURRENCY_FALLBACK[c] ?? "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * CTA button colors for a dark background. Uses the brand color when it is
 * saturated enough to stand out; otherwise (grey/silver/near-black brands)
 * falls back to a white button.
 */
export function ctaColors(hex: string): { background: string; text: string } {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return { background: "#ffffff", text: "#111111" };
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  if (saturation < 0.35 || max < 0.35) return { background: "#ffffff", text: "#111111" };
  return { background: hex, text: readableTextColor(hex) };
}

/** Picks black or white text for readable contrast on a hex background. */
export function readableTextColor(hex: string): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return "#ffffff";
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? "#111111" : "#ffffff";
}
