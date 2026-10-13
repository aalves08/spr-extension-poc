/**
 * Run `fn` over `items` with at most `limit` calls in flight. Results keep the input order.
 * Rejections are returned as `{ error }` so one failing item doesn't stop the rest.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onSettled?: (done: number, total: number) => void
): Promise<({ value: R; error?: undefined } | { value?: undefined; error: any })[]> {
  const results: ({ value: R; error?: undefined } | { value?: undefined; error: any })[] = new Array(items.length);
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < items.length) {
      const idx = next++;

      try {
        results[idx] = { value: await fn(items[idx], idx) };
      } catch (error) {
        results[idx] = { error };
      }

      done++;
      onSettled?.(done, items.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));

  return results;
}
