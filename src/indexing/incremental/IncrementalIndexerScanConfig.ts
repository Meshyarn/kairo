export function resolveScanBatchSize(): number {
  const raw = Number(process.env.KAIRO_INDEX_SCAN_BATCH_SIZE ?? "");
  const candidate = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 200;
  return Math.max(50, candidate);
}

export function resolveIgnoreScanBatchSize(): number {
  const raw = Number(process.env.KAIRO_INDEX_IGNORE_BATCH_SIZE ?? "");
  const candidate = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 500;
  return Math.max(100, candidate);
}
