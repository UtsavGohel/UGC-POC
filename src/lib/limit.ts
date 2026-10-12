/** Minimal semaphore: at most `max` tasks run at once across all callers. */
export function createLimiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/**
 * Runs tasks with a concurrency limit and waits for ALL of them before
 * reporting a failure. Siblings of a failed task still finish, so their
 * (already paid) results get saved and can be reused on retry.
 */
export async function mapSettled<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const run = createLimiter(limit);
  const results = await Promise.allSettled(items.map((item, i) => run(() => fn(item, i))));
  const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failure) throw failure.reason;
  return results.map((r) => (r as PromiseFulfilledResult<R>).value);
}

const keyedTails = new Map<string, Promise<unknown>>();

/**
 * In-process mutex per key: tasks with the same key run one after another.
 * Used so parallel jobs in this worker never pay twice for the same shared
 * output (it does not depend on database session features, which poolers like
 * PgBouncer/Neon's pooled endpoint don't support).
 */
export async function withKeyLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = keyedTails.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  const tail = run.catch(() => {});
  keyedTails.set(key, tail);
  try {
    return await run;
  } finally {
    if (keyedTails.get(key) === tail) keyedTails.delete(key);
  }
}
