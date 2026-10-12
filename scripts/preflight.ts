/**
 * Checks everything the app needs, then applies database migrations.
 * Run by `npm run dev:all` before starting the web app and the worker.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, db } from "@/lib/db";
import { env } from "@/lib/env";
import { assertModelsPriced } from "@/lib/pricing";

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function ok(message: string) {
  console.log(`✓ ${message}`);
}

async function main() {
  if (!existsSync(".env.local")) {
    fail("Missing .env.local. Run: cp .env.example .env.local  — then set DATABASE_URL and GEMINI_API_KEY.");
  }

  try {
    env();
    assertModelsPriced();
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  ok("Environment");

  for (const bin of ["ffmpeg", "ffprobe"]) {
    if (spawnSync(bin, ["-version"], { stdio: "ignore" }).status !== 0) {
      fail(`${bin} not found. Install it with: brew install ffmpeg`);
    }
  }
  ok("FFmpeg");

  try {
    await db().execute("select 1");
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    fail(
      `Cannot connect to the database: ${cause instanceof Error ? cause.message || cause.name : cause}\n` +
        "  Check DATABASE_URL (use Neon's non-pooled URL or Supabase's session/direct URL).",
    );
  }
  ok("Database connection");

  await migrate(db(), { migrationsFolder: "drizzle" });
  ok("Database migrations");

  await closeDb();
  console.log("\nStarting web app (http://localhost:3000) and worker…\n");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
