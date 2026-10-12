import { eq } from "drizzle-orm";
import { closeDb, db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { assertModelsPriced } from "@/lib/pricing";
import { getBoss, QUEUES, type AnalyzeProductJob, type AssetJob } from "@/lib/queue";
import { analyzeProductJob } from "./jobs/analyze";
import { productVideoJob } from "./jobs/product-video";
import { staticAdJob } from "./jobs/static-ad";
import { ugcVideoJob } from "./jobs/ugc-video";

const SHUTDOWN_TIMEOUT_MS = 20 * 60_000;

/**
 * Anything still "running" at startup was interrupted by a previous worker
 * (crash or Ctrl+C). Mark it failed so it can be retried; the retry reuses
 * saved scenes/clips and resumes Veo renders that were still in progress.
 * Assumes a single worker process, which is the setup for this POC.
 */
async function recoverInterruptedAssets(): Promise<void> {
  const rows = await db()
    .update(schema.assets)
    .set({
      status: "failed",
      error: "Interrupted (worker stopped). Click Retry: finished parts are reused at no extra cost.",
      updatedAt: new Date(),
    })
    .where(eq(schema.assets.status, "running"))
    .returning({ id: schema.assets.id });
  if (rows.length) console.warn(`[worker] marked ${rows.length} interrupted asset(s) as failed`);

  await db()
    .update(schema.products)
    .set({ status: "failed", error: "Interrupted (worker stopped). Click Re-analyze." })
    .where(eq(schema.products.status, "analyzing"));
}

async function main(): Promise<void> {
  const config = env(); // fail fast on missing configuration
  assertModelsPriced(); // never spend with an unpriced model
  await recoverInterruptedAssets();

  const boss = await getBoss("worker");
  // Jobs wake workers via LISTEN/NOTIFY; this poll is only a slow fallback,
  // so a serverless database (Neon) can still scale to zero when idle.
  const polling = { pollingIntervalSeconds: config.WORKER_POLL_SECONDS };

  await boss.work<AnalyzeProductJob>(QUEUES.analyzeProduct, { ...polling, localConcurrency: 1 }, async ([job]) =>
    analyzeProductJob(job.data.productId),
  );
  await boss.work<AssetJob>(QUEUES.staticAd, { ...polling, localConcurrency: 3 }, async ([job]) =>
    staticAdJob(job.data),
  );
  // Veo calls are additionally capped process-wide by VEO_MAX_CONCURRENCY.
  await boss.work<AssetJob>(QUEUES.productVideo, { ...polling, localConcurrency: 2 }, async ([job]) =>
    productVideoJob(job.data),
  );
  await boss.work<AssetJob>(QUEUES.ugcVideo, { ...polling, localConcurrency: 1 }, async ([job]) =>
    ugcVideoJob(job.data),
  );

  console.log("[worker] ready. Queues:", Object.values(QUEUES).join(", "));

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) {
      console.warn("[worker] forced exit. Interrupted assets can be retried; Veo renders will be resumed.");
      process.exit(1);
    }
    stopping = true;
    console.log(
      `[worker] ${signal}: waiting for running jobs to finish (up to 20 min). Press Ctrl+C again to force quit.`,
    );
    await boss.stop({ graceful: true, timeout: SHUTDOWN_TIMEOUT_MS });
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[worker] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
