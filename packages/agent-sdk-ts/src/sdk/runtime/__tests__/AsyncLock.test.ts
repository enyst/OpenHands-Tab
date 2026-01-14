import { describe, it, expect, vi } from 'vitest';
import { AsyncLock } from '../AsyncLock';

describe('AsyncLock', () => {
  it('executes a single function and returns its result', async () => {
    const lock = new AsyncLock();
    const result = await lock.acquire(async () => 42);
    expect(result).toBe(42);
  });

  it('executes functions sequentially', async () => {
    const lock = new AsyncLock();
    const order: number[] = [];

    const p1 = lock.acquire(async () => {
      await delay(20);
      order.push(1);
      return 'first';
    });

    const p2 = lock.acquire(async () => {
      order.push(2);
      return 'second';
    });

    const p3 = lock.acquire(async () => {
      order.push(3);
      return 'third';
    });

    const results = await Promise.all([p1, p2, p3]);
    expect(results).toEqual(['first', 'second', 'third']);
    expect(order).toEqual([1, 2, 3]);
  });

  it('releases lock even when function throws', async () => {
    const lock = new AsyncLock();
    const order: string[] = [];

    const p1 = lock.acquire(async () => {
      order.push('first-start');
      throw new Error('First failed');
    }).catch(() => {
      order.push('first-caught');
      return 'first-error';
    });

    const p2 = lock.acquire(async () => {
      order.push('second-start');
      return 'second-success';
    });

    const results = await Promise.all([p1, p2]);

    expect(results[0]).toBe('first-error');
    expect(results[1]).toBe('second-success');
    expect(order).toEqual(['first-start', 'first-caught', 'second-start']);
  });

  it('handles nested acquire calls from different locks', async () => {
    const lock1 = new AsyncLock();
    const lock2 = new AsyncLock();
    const order: string[] = [];

    const result = await lock1.acquire(async () => {
      order.push('lock1-start');
      const innerResult = await lock2.acquire(async () => {
        order.push('lock2');
        return 'inner';
      });
      order.push('lock1-end');
      return `outer-${innerResult}`;
    });

    expect(result).toBe('outer-inner');
    expect(order).toEqual(['lock1-start', 'lock2', 'lock1-end']);
  });

  it('maintains proper queue ordering under concurrent stress', async () => {
    const lock = new AsyncLock();
    const results: number[] = [];
    const count = 10;

    const promises = Array.from({ length: count }, (_, i) =>
      lock.acquire(async () => {
        await delay(Math.random() * 5);
        results.push(i);
        return i;
      })
    );

    const returned = await Promise.all(promises);

    // Results should be in order they were queued
    expect(results).toEqual(Array.from({ length: count }, (_, i) => i));
    expect(returned).toEqual(Array.from({ length: count }, (_, i) => i));
  });

  it('supports returning different types', async () => {
    const lock = new AsyncLock();

    const str = await lock.acquire(async () => 'hello');
    const num = await lock.acquire(async () => 123);
    const obj = await lock.acquire(async () => ({ foo: 'bar' }));
    const arr = await lock.acquire(async () => [1, 2, 3]);
    const nul = await lock.acquire(async () => null);

    expect(str).toBe('hello');
    expect(num).toBe(123);
    expect(obj).toEqual({ foo: 'bar' });
    expect(arr).toEqual([1, 2, 3]);
    expect(nul).toBe(null);
  });

  it('propagates errors correctly', async () => {
    const lock = new AsyncLock();

    await expect(lock.acquire(async () => {
      throw new Error('Test error');
    })).rejects.toThrow('Test error');
  });

  it('handles synchronously resolving functions', async () => {
    const lock = new AsyncLock();
    const order: number[] = [];

    const p1 = lock.acquire(async () => {
      order.push(1);
      return 1;
    });

    const p2 = lock.acquire(async () => {
      order.push(2);
      return 2;
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('handles void returning functions', async () => {
    const lock = new AsyncLock();
    const sideEffect = vi.fn();

    await lock.acquire(async () => {
      sideEffect('called');
    });

    expect(sideEffect).toHaveBeenCalledWith('called');
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
