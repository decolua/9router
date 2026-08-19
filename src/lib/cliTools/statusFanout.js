export const CLI_STATUS_CONCURRENCY = 3;

/**
 * Map a list with a fixed worker count.  This keeps a dashboard refresh from
 * starting every CLI status probe at once on Windows.
 */
export async function mapWithConcurrency(items, concurrency, mapper) {
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, items.length || 1));
  const results = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

