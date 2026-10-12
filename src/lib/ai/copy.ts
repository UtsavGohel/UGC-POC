import { z } from "zod";
import type { BrandProfile } from "@/lib/db/schema";
import type { InputImage } from "./client";
import { generateJson } from "./text";

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Expected a #RRGGBB color");

export const brandProfileSchema = z.object({
  brandName: z.string().describe("Brand name, or a short plausible one if unknown"),
  productName: z.string(),
  category: z.string().describe("Product category, e.g. 'skincare serum'"),
  oneLiner: z.string().describe("What the product is and does, max 20 words"),
  benefits: z.array(z.string()).min(3).max(6).describe("Customer benefits, not features"),
  painPoints: z.array(z.string()).min(2).max(5).describe("Problems the buyer has before the product"),
  targetAudience: z.string(),
  tone: z.string().describe("Brand voice in 3-6 words, e.g. 'warm, confident, playful'"),
  priceText: z.string().describe("Price as shown on the page, or empty string"),
  visualStyle: z
    .string()
    .describe("Photography direction that fits the brand: settings, light, mood, props"),
  colors: z.object({
    primary: hexColor.describe("Main brand color taken from the product or packaging"),
    secondary: hexColor.describe("Accent color that contrasts with the primary"),
  }),
}) satisfies z.ZodType<BrandProfile>;

export const ANGLE_TYPES = [
  "problem_solution",
  "testimonial",
  "unboxing",
  "before_after",
  "reasons_why",
  "social_proof",
  "lifestyle",
  "offer",
] as const;

export const angleSchema = z.object({
  type: z.enum(ANGLE_TYPES),
  title: z.string().describe("Internal name of the angle, max 6 words"),
  hook: z.string().describe("Scroll-stopping first line for the first 2 seconds, max 12 words"),
  headline: z.string().describe("Image headline, max 6 words. No emoji, no prices, no currency symbols"),
  subheadline: z.string().describe("Supporting line on the image, max 10 words. No emoji, no prices, no currency symbols"),
  cta: z.string().describe("Call to action button text, max 3 words, e.g. 'Shop now'"),
  caption: z
    .string()
    .describe("Social post caption: hook, 2-3 short lines, CTA, 3-5 hashtags. Max 350 characters"),
  sceneIdea: z
    .string()
    .describe("A photo scene for the static ad that shows this angle. Describe setting, light, props and how the product is placed. No people's faces"),
  voiceover: z
    .string()
    .describe("Voiceover for a 12-second product video, 22-28 words, spoken naturally. No prices or numbers, no emoji or hashtags"),
  productShots: z
    .array(
      z.object({
        scene: z.string().describe("Still scene with the product as hero, setting and light"),
        motion: z.string().describe("One slow camera movement for an 8-second shot (e.g. slow push-in, gentle orbit). The product stays still and unchanged; no added objects, text or props appearing"),
      }),
    )
    .length(2),
  ugcScript: z.object({
    persona: z
      .string()
      .describe("Adult creator who fits the audience: age range, look, clothing. No celebrities"),
    setting: z.string().describe("Everyday location for a phone-filmed video, e.g. 'bright bathroom'"),
    lines: z
      .array(z.string().describe("One spoken line, 12-18 words, natural and conversational, no prices"))
      .length(3)
      .describe("Line 1 = hook, line 2 = experience/benefit, line 3 = recommendation + CTA"),
  }),
});

export type GeneratedAngle = z.infer<typeof angleSchema>;

const COPYWRITER_SYSTEM = `You are a senior performance-marketing creative strategist who writes
paid social ads (Meta, TikTok, Instagram) for direct-to-consumer brands worldwide.
Rules:
- Only claim what the product information supports. Never invent medical, legal or
  numeric claims (no "clinically proven", no fake percentages, no fake reviews counts).
- Write in clear, simple English that works for a global audience.
- Be specific to this product; avoid generic marketing filler.
- Never put prices, discounts or currency symbols in headlines, subheadlines, CTAs,
  voiceovers or scripts (prices change and differ by market). The post caption may mention an offer only if the product information states one.`;

export async function analyzeProduct(input: {
  name: string;
  description?: string | null;
  pageText?: string | null;
  images: InputImage[];
}) {
  const prompt = [
    "Analyze this product for ad creation and return the brand profile.",
    `Product name given by the user: ${input.name}`,
    input.description ? `Description from the user:\n${input.description}` : null,
    input.pageText ? `Text from the product page:\n${input.pageText}` : null,
    input.images.length
      ? "The attached images are the real product photos. Take colors from the packaging."
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return generateJson({
    schema: brandProfileSchema,
    system: COPYWRITER_SYSTEM,
    prompt,
    images: input.images,
  });
}

export async function generateAngles(input: {
  brand: BrandProfile;
  count: number;
  images: InputImage[];
}) {
  const schema = z.object({ angles: z.array(angleSchema).min(1).max(10) });
  const prompt = `Create ${input.count} distinct ad angles for this product. Use a different
angle type for each where possible, and make every hook different.

Brand profile:
${JSON.stringify(input.brand, null, 2)}

The attached image is the real product. Scenes and shots must feature this exact product.`;

  return generateJson({
    schema,
    system: COPYWRITER_SYSTEM,
    prompt,
    images: input.images.slice(0, 1),
  });
}
