import { pLimit, parallelMap } from '../../src/lib/p-limit';

describe('pLimit', () => {
  test('rejects concurrency < 1', () => {
    expect(() => pLimit(0)).toThrow('concurrency must be >= 1');
  });

  test('runs tasks and returns results in order', async () => {
    const limit = pLimit(3);
    const results = await Promise.all([
      limit(async () => 1),
      limit(async () => 2),
      limit(async () => 3),
    ]);
    expect(results).toEqual([1, 2, 3]);
  });

  test('never exceeds concurrency limit', async () => {
    const CONCURRENCY = 2;
    const limit = pLimit(CONCURRENCY);

    let peak = 0;
    let active = 0;

    function track() {
      active++;
      if (active > peak) peak = active;
    }
    function release() {
      active--;
    }

    const tasks = Array.from({ length: 10 }, (_, i) =>
      limit(async () => {
        track();
        await new Promise((r) => setTimeout(r, 10));
        release();
        return i;
      }),
    );

    const results = await Promise.all(tasks);
    expect(peak).toBeLessThanOrEqual(CONCURRENCY);
    expect(peak).toBeGreaterThan(1); // actually hit concurrency > 1
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('preserves FIFO ordering under contention', async () => {
    const limit = pLimit(1); // serial
    const order: number[] = [];

    const tasks = Array.from({ length: 5 }, (_, i) =>
      limit(async () => {
        order.push(i);
        await new Promise((r) => setTimeout(r, 5));
        return i;
      }),
    );

    await Promise.all(tasks);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  test('propagates rejections', async () => {
    const limit = pLimit(2);

    await expect(
      limit(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  test('handles empty array', async () => {
    const results = await parallelMap([], 3, async (x) => x * 2);
    expect(results).toEqual([]);
  });
});

describe('parallelMap', () => {
  test('returns results in input order', async () => {
    const results = await parallelMap([1, 2, 3, 4, 5], 2, async (x) => {
      await new Promise((r) => setTimeout(r, x * 5));
      return x * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  test('respects concurrency bound', async () => {
    let peak = 0;
    let active = 0;

    const results = await parallelMap(
      Array.from({ length: 20 }, (_, i) => i),
      3,
      async (x) => {
        active++;
        if (active > peak) peak = active;
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return x;
      },
    );

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });
});
