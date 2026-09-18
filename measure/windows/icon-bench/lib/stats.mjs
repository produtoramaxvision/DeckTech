export function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return NaN;
  const idx = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1);
  return sortedAsc[Math.max(0, idx)];
}

export function summarize(samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = n ? sorted.reduce((a, b) => a + b, 0) / n : NaN;
  return {
    n,
    meanMs: Number(mean.toFixed(2)),
    medianMs: Number(percentile(sorted, 50).toFixed(2)),
    p95Ms: Number(percentile(sorted, 95).toFixed(2)),
    minMs: n ? Number(sorted[0].toFixed(2)) : NaN,
    maxMs: n ? Number(sorted[n - 1].toFixed(2)) : NaN,
  };
}
