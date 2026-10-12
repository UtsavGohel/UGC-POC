/** Browser URL for a storage-relative file path. Safe to import in client components. */
export function fileUrl(relPath: string, opts?: { download?: boolean; version?: string | number }): string {
  const encoded = relPath.split("/").map(encodeURIComponent).join("/");
  const params = new URLSearchParams();
  if (opts?.download) params.set("download", "1");
  if (opts?.version !== undefined) params.set("v", String(opts.version));
  const query = params.toString();
  return `/api/files/${encoded}${query ? `?${query}` : ""}`;
}

export function formatUsd(value: number): string {
  return value < 1 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`;
}
