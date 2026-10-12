/* eslint-disable @next/next/no-img-element -- rendered by Satori to PNG, not by the browser */
import type { AspectRatio, BrandColors } from "@/lib/db/schema";
import { ctaColors, dataUri, readableTextColor, renderPng, stripEmoji } from "./satori";

export const STATIC_AD_SIZES: Record<AspectRatio, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

/**
 * Bottom padding keeps text clear of platform UI: Reels/Stories overlay the
 * bottom ~20% of a 9:16 frame with captions and buttons.
 */
const SAFE_BOTTOM: Record<AspectRatio, number> = {
  "1:1": 72,
  "4:5": 88,
  "9:16": 400,
};

export async function renderStaticAd(opts: {
  scenePng: Buffer;
  aspectRatio: AspectRatio;
  brandName: string;
  headline: string;
  subheadline: string;
  cta: string;
  colors: BrandColors;
}): Promise<Buffer> {
  const { width, height } = STATIC_AD_SIZES[opts.aspectRatio];
  // The CTA sits on a dark gradient: a pale or grey brand color would vanish there.
  const cta = ctaColors(opts.colors.primary);
  const headlineSize = opts.aspectRatio === "1:1" ? 76 : 84;

  return renderPng(
    <div style={{ display: "flex", position: "relative", width, height, fontFamily: "Inter" }}>
      <img
        alt=""
        src={dataUri(opts.scenePng)}
        width={width}
        height={height}
        style={{ position: "absolute", top: 0, left: 0, width, height, objectFit: "cover" }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: height * 0.6,
          backgroundImage:
            "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0.8) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 56,
          left: 56,
          display: "flex",
          padding: "12px 24px",
          borderRadius: 999,
          backgroundColor: "rgba(255,255,255,0.9)",
          color: "#111111",
          fontSize: 30,
          fontWeight: 600,
        }}
      >
        {stripEmoji(opts.brandName)}
      </div>
      <div
        style={{
          position: "absolute",
          left: 64,
          right: 64,
          bottom: SAFE_BOTTOM[opts.aspectRatio],
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            color: "#ffffff",
            fontSize: headlineSize,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: -1.5,
          }}
        >
          {stripEmoji(opts.headline)}
        </div>
        <div style={{ display: "flex", color: "rgba(255,255,255,0.92)", fontSize: 38, lineHeight: 1.25 }}>
          {stripEmoji(opts.subheadline)}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 12,
            padding: "22px 44px",
            borderRadius: 999,
            backgroundColor: cta.background,
            color: cta.text,
            fontSize: 36,
            fontWeight: 800,
          }}
        >
          {stripEmoji(opts.cta)}
        </div>
      </div>
    </div>,
    width,
    height,
  );
}

/** Transparent overlay with one caption chunk, burned into videos by FFmpeg. */
export async function renderCaption(opts: {
  text: string;
  width: number;
  height: number;
}): Promise<Buffer> {
  const { width, height } = opts;
  const scale = width / 720;
  return renderPng(
    <div
      style={{
        display: "flex",
        width,
        height,
        alignItems: "flex-start",
        justifyContent: "center",
        // Lower third: below the product (usually centred) and above the
        // platform UI that covers the bottom ~20% of a Reel/TikTok.
        paddingTop: height * 0.74,
        fontFamily: "Inter",
      }}
    >
      <div
        style={{
          display: "flex",
          maxWidth: width * 0.84,
          padding: `${12 * scale}px ${22 * scale}px`,
          borderRadius: 16 * scale,
          backgroundColor: "rgba(0,0,0,0.68)",
          color: "#ffffff",
          fontSize: 44 * scale,
          fontWeight: 800,
          lineHeight: 1.2,
          textAlign: "center",
        }}
      >
        {stripEmoji(opts.text)}
      </div>
    </div>,
    width,
    height,
  );
}

export async function renderEndCard(opts: {
  productPng: Buffer;
  brandName: string;
  headline: string;
  cta: string;
  colors: BrandColors;
  width: number;
  height: number;
}): Promise<Buffer> {
  const { width, height } = opts;
  const scale = width / 720;
  const fg = readableTextColor(opts.colors.primary);
  const ctaFg = readableTextColor(opts.colors.secondary);
  const productSize = width * 0.62;

  return renderPng(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width,
        height,
        gap: 36 * scale,
        backgroundColor: opts.colors.primary,
        fontFamily: "Inter",
        padding: 48 * scale,
      }}
    >
      <div style={{ display: "flex", color: fg, fontSize: 30 * scale, fontWeight: 600, opacity: 0.85 }}>
        {stripEmoji(opts.brandName)}
      </div>
      <img
        alt=""
        src={dataUri(opts.productPng)}
        width={productSize}
        height={productSize}
        style={{ objectFit: "contain", borderRadius: 24 * scale }}
      />
      <div
        style={{
          display: "flex",
          color: fg,
          fontSize: 56 * scale,
          fontWeight: 800,
          textAlign: "center",
          lineHeight: 1.1,
        }}
      >
        {stripEmoji(opts.headline)}
      </div>
      <div
        style={{
          display: "flex",
          padding: `${18 * scale}px ${40 * scale}px`,
          borderRadius: 999,
          backgroundColor: opts.colors.secondary,
          color: ctaFg,
          fontSize: 34 * scale,
          fontWeight: 800,
        }}
      >
        {stripEmoji(opts.cta)}
      </div>
    </div>,
    width,
    height,
  );
}
