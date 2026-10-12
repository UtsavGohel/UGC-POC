import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { connection } from "next/server";
import { db, schema } from "@/lib/db";
import type { Angle, Asset, Product } from "@/lib/db/schema";

export interface ProductListItem {
  id: string;
  name: string;
  status: Product["status"];
  createdAt: Date;
  thumbnail: string | null;
  assetCount: number;
  costUsd: number;
}

export async function listProducts(): Promise<ProductListItem[]> {
  await connection(); // live data: never prerender
  const rows = await db()
    .select({
      id: schema.products.id,
      name: schema.products.name,
      status: schema.products.status,
      createdAt: schema.products.createdAt,
      images: schema.products.images,
      assetCount: sql<number>`(select count(*)::int from ${schema.assets} a where a.product_id = ${schema.products.id} and a.status = 'done')`,
      costUsd: sql<number>`(select coalesce(sum(c.cost_usd), 0)::float from ${schema.costEvents} c where c.product_id = ${schema.products.id})`,
    })
    .from(schema.products)
    .orderBy(desc(schema.products.createdAt));

  return rows.map(({ images, ...r }) => ({ ...r, thumbnail: images[0] ?? null }));
}

export interface CostLine {
  operation: string;
  count: number;
  costUsd: number;
}

export interface ProductDetail {
  product: Product;
  angles: Angle[];
  assets: Asset[];
  costs: CostLine[];
  totalCostUsd: number;
}

export async function getProductDetail(id: string): Promise<ProductDetail | null> {
  await connection();
  const product = await db().query.products.findFirst({ where: eq(schema.products.id, id) });
  if (!product) return null;

  const [angles, assets, costs] = await Promise.all([
    db().query.angles.findMany({
      where: eq(schema.angles.productId, id),
      orderBy: asc(schema.angles.position),
    }),
    db().query.assets.findMany({
      where: eq(schema.assets.productId, id),
      orderBy: asc(schema.assets.createdAt),
    }),
    db()
      .select({
        operation: schema.costEvents.operation,
        count: sql<number>`count(*)::int`,
        costUsd: sql<number>`sum(${schema.costEvents.costUsd})::float`,
      })
      .from(schema.costEvents)
      .where(eq(schema.costEvents.productId, id))
      .groupBy(schema.costEvents.operation)
      .orderBy(desc(sql`sum(${schema.costEvents.costUsd})`)),
  ]);

  return {
    product,
    angles,
    assets,
    costs,
    totalCostUsd: costs.reduce((sum, c) => sum + c.costUsd, 0),
  };
}

/** All AI spend ever recorded, including deleted products. */
export async function getTotalSpendUsd(): Promise<number> {
  await connection();
  const [row] = await db()
    .select({ total: sql<number>`coalesce(sum(${schema.costEvents.costUsd}), 0)::float` })
    .from(schema.costEvents);
  return row?.total ?? 0;
}
