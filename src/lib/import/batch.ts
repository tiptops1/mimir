// S13b — batch slicing for the Inngest commit loop (60 s step budget).
export function sliceBatches<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error(`Batch size must be >= 1, got ${size}`);
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
