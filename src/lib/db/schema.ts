import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const productStatus = pgEnum("product_status", [
  "analyzing",
  "ready",
  "failed",
]);

export const assetKind = pgEnum("asset_kind", [
  "static_ad",
  "product_video",
  "ugc_video",
]);

export const assetStatus = pgEnum("asset_status", [
  "queued",
  "running",
  "done",
  "failed",
]);

export const angleType = pgEnum("angle_type", [
  "problem_solution",
  "testimonial",
  "unboxing",
  "before_after",
  "reasons_why",
  "social_proof",
  "lifestyle",
  "offer",
]);

export interface BrandColors {
  primary: string;
  secondary: string;
}

export interface BrandProfile {
  brandName: string;
  productName: string;
  category: string;
  oneLiner: string;
  benefits: string[];
  painPoints: string[];
  targetAudience: string;
  tone: string;
  priceText: string;
  visualStyle: string;
  colors: BrandColors;
}

export interface UgcScript {
  persona: string;
  setting: string;
  lines: string[];
}

export interface ProductShot {
  scene: string;
  motion: string;
}

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  sourceUrl: text("source_url"),
  description: text("description"),
  /** Storage-relative paths of the normalized product photos. */
  images: jsonb("images").$type<string[]>().notNull().default([]),
  brand: jsonb("brand").$type<BrandProfile>(),
  status: productStatus("status").notNull().default("analyzing"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const angles = pgTable(
  "angles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    type: angleType("type").notNull(),
    title: text("title").notNull(),
    hook: text("hook").notNull(),
    headline: text("headline").notNull(),
    subheadline: text("subheadline").notNull(),
    cta: text("cta").notNull(),
    caption: text("caption").notNull(),
    sceneIdea: text("scene_idea").notNull(),
    voiceover: text("voiceover").notNull(),
    productShots: jsonb("product_shots").$type<ProductShot[]>().notNull(),
    ugcScript: jsonb("ugc_script").$type<UgcScript>().notNull(),
    selected: boolean("selected").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("angles_product_idx").on(t.productId)],
);

export type AspectRatio = "1:1" | "4:5" | "9:16";

/** Veo operations started for an asset, keyed by output file, so a retry can resume them. */
export type VeoOperations = Record<string, { name: string; costRecorded: boolean }>;

export interface AssetMeta {
  /** Width x height of the final file. */
  width?: number;
  height?: number;
  durationSeconds?: number;
  /** AI scene behind a static ad, kept for re-rendering without paying again. */
  scenePath?: string;
  /** Poster frame shown before a video plays. */
  posterPath?: string;
}

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    angleId: uuid("angle_id")
      .notNull()
      .references(() => angles.id, { onDelete: "cascade" }),
    kind: assetKind("kind").notNull(),
    aspectRatio: text("aspect_ratio").$type<AspectRatio>().notNull(),
    status: assetStatus("status").notNull().default("queued"),
    filePath: text("file_path"),
    meta: jsonb("meta").$type<AssetMeta>().notNull().default({}),
    operations: jsonb("operations").$type<VeoOperations>().notNull().default({}),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("assets_product_idx").on(t.productId),
    index("assets_angle_idx").on(t.angleId),
  ],
);

/**
 * Spend ledger. Deliberately has no foreign keys: money spent on a product or
 * asset that is deleted later (even mid-generation) must still be recorded.
 */
export const costEvents = pgTable(
  "cost_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").notNull(),
    assetId: uuid("asset_id"),
    operation: text("operation").notNull(),
    model: text("model").notNull(),
    quantity: numeric("quantity", { mode: "number" }).notNull(),
    unit: text("unit").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("cost_events_product_idx").on(t.productId),
    index("cost_events_created_idx").on(t.createdAt),
  ],
);

export type Product = typeof products.$inferSelect;
export type Angle = typeof angles.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type CostEvent = typeof costEvents.$inferSelect;
