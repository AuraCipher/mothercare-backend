/**
 * Minimal bounded-concurrency limiter (zero dependencies).
 *
 * Returns a `limit(fn)` wrapper that schedules `fn` for execution but
 * never more than `concurrency` functions at the same time.  Once the
 * limit is reached, callers are queued and executed in FIFO order as
 * earlier tasks complete.
 *
 * Rationale for default concurrency = 5:
 *   - Production VPS has `connection_limit=12` in DATABASE_URL
 *   - 5 concurrent DB ops leaves 7 connections for other requests,
 *     health checks, and background workers on the same VPS
 *   - At concurrency 5 a 50-student class completes in ~10 rounds
 *     (each upsert ≈ 2-5 ms) → total ≈ 50 ms, still far faster
 *     than fully sequential (250 ms)
 */

export type LimitFn = <T>(fn: () => Promise<T>) => Promise<T>;

export function pLimit(concurrency: number): LimitFn {
  if (concurrency < 1) throw new Error('pLimit: concurrency must be >= 1');

  let active = 0;
  const queue: Array<() => void> = [];

  function release() {
    active--;
    if (queue.length > 0 && active < concurrency) {
      queue.shift()!();
    }
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      function run() {
        active++;
        fn().then(resolve, reject).finally(release);
      }

      if (active < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

/**
 * Execute an array of async tasks with bounded concurrency.
 * Returns results in the same order as the input tasks.
 */
export async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = pLimit(concurrency);
  return Promise.all(items.map((item, i) => limit(() => fn(item, i))));
}
