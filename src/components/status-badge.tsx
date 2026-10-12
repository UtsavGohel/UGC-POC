const STYLES: Record<string, string> = {
  queued: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  analyzing: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  ready: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

const LABELS: Record<string, string> = {
  queued: "Queued",
  running: "Generating",
  analyzing: "Analyzing",
  done: "Done",
  ready: "Ready",
  failed: "Failed",
};

export function StatusBadge({ status }: { status: string }) {
  const busy = status === "running" || status === "analyzing";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status] ?? STYLES.queued}`}
    >
      {busy && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {LABELS[status] ?? status}
    </span>
  );
}
