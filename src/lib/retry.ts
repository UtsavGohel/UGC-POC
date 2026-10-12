import { setTimeout as sleep } from "node:timers/promises";
import { ApiError } from "@google/genai";

/**
 * Rate limits (429), server errors (5xx) and network failures are rejected
 * before any work is billed, so retrying them is free. Anything else (bad
 * request, safety block, invalid output) is not retried here.
 */
export function isTransientError(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 429 || err.status >= 500;
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code ?? (err.cause as NodeJS.ErrnoException)?.code;
    return (
      err.name === "AbortError" ||
      err.name === "TimeoutError" ||
      err.message === "fetch failed" ||
      ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_SOCKET"].includes(code ?? "")
    );
  }
  return false;
}

function isRateLimit(err: unknown): boolean {
  return err instanceof ApiError && err.status === 429;
}

/** Short, human-readable message for errors shown in the UI. */
export function describeError(err: unknown): string {
  if (isRateLimit(err)) {
    return (
      "Google API quota/rate limit reached (429). Wait a few minutes, then click Retry — " +
      "finished parts are reused. If it keeps happening, set VEO_MAX_CONCURRENCY=1 or check " +
      "your limits at https://aistudio.google.com/usage."
    );
  }
  if (err instanceof ApiError) {
    try {
      const parsed = JSON.parse(err.message) as { error?: { message?: string } };
      if (parsed.error?.message) return `Google API error ${err.status}: ${parsed.error.message}`;
    } catch {
      /* not JSON */
    }
    return `Google API error ${err.status}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 2_000;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isTransientError(err)) throw err;
      // Exponential backoff with jitter: ~2s, 4s, 8s... Rate limits (429) are
      // usually per-minute windows, so they wait longer: ~20s, 40s, 80s.
      const base = isRateLimit(err) ? Math.max(baseDelayMs, 20_000) : baseDelayMs;
      const delay = base * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5);
      console.warn(
        `[retry] ${label} failed (attempt ${attempt}/${attempts}), retrying in ${(delay / 1000).toFixed(1)}s:`,
        err instanceof Error ? err.message : err,
      );
      await sleep(delay);
    }
  }
}
