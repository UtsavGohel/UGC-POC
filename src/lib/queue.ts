import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";

export const QUEUES = {
  analyzeProduct: "analyze-product",
  staticAd: "generate-static-ad",
  productVideo: "generate-product-video",
  ugcVideo: "generate-ugc-video",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface AnalyzeProductJob {
  productId: string;
}

export interface AssetJob {
  assetId: string;
  /** Generate brand-new creative instead of reusing saved scenes/clips. */
  fresh?: boolean;
}

/**
 * Jobs are never retried by pg-boss: transient API errors are retried per call
 * (free), and anything else is shown in the UI so a person decides whether to
 * spend again. `notify` wakes the worker as soon as a job is queued, so idle
 * polling can be slow (keeps serverless Postgres like Neon able to sleep).
 */
export const QUEUE_OPTIONS: Record<QueueName, { expireInSeconds: number; retryLimit: 0; notify: true }> = {
  [QUEUES.analyzeProduct]: { expireInSeconds: 600, retryLimit: 0, notify: true },
  [QUEUES.staticAd]: { expireInSeconds: 900, retryLimit: 0, notify: true },
  [QUEUES.productVideo]: { expireInSeconds: 2700, retryLimit: 0, notify: true },
  [QUEUES.ugcVideo]: { expireInSeconds: 2700, retryLimit: 0, notify: true },
};

const globalForBoss = globalThis as unknown as {
  __boss?: Promise<PgBoss>;
};

async function createBoss(role: "web" | "worker"): Promise<PgBoss> {
  const isWorker = role === "worker";
  const boss = new PgBoss({
    connectionString: env().DATABASE_URL,
    // The web app only sends jobs: no maintenance, no listener, tiny pool.
    supervise: isWorker,
    schedule: isWorker,
    useListenNotify: isWorker,
    max: isWorker ? 4 : 2,
  });
  boss.on("error", (err) => console.error("[pg-boss]", err));
  await boss.start();
  for (const name of Object.values(QUEUES)) {
    await boss.createQueue(name, QUEUE_OPTIONS[name]); // no-op if it exists
    if (isWorker) await boss.updateQueue(name, QUEUE_OPTIONS[name]); // keep options in sync
  }
  return boss;
}

/** Shared pg-boss instance (one per process). */
export function getBoss(role: "web" | "worker" = "web"): Promise<PgBoss> {
  if (!globalForBoss.__boss) {
    globalForBoss.__boss = createBoss(role).catch((err) => {
      globalForBoss.__boss = undefined;
      throw err;
    });
  }
  return globalForBoss.__boss;
}

export async function enqueue(
  name: QueueName,
  data: AnalyzeProductJob | AssetJob,
): Promise<void> {
  const boss = await getBoss();
  await boss.send(name, data);
}
