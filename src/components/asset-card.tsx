import { deleteAsset, regenerateAsset } from "@/app/actions";
import type { Asset } from "@/lib/db/schema";
import { fileUrl, formatUsd } from "@/lib/urls";
import { StatusBadge } from "./status-badge";
import { buttonClass } from "./button-class";
import { ActionButton } from "./ui";

const KIND_LABEL: Record<Asset["kind"], string> = {
  static_ad: "Static ad",
  product_video: "Product video",
  ugc_video: "UGC video",
};

const ASPECT_CLASS: Record<Asset["aspectRatio"], string> = {
  "1:1": "aspect-square",
  "4:5": "aspect-[4/5]",
  "9:16": "aspect-[9/16]",
};

/** Mirrors STALE_AFTER_MS in actions.ts: a job busy this long is presumed dead. */
const STALE_AFTER_MS = 45 * 60_000;

export function AssetCard({ asset, freshCostUsd }: { asset: Asset; freshCostUsd: number }) {
  const version = asset.updatedAt.getTime(); // bust browser cache after regeneration
  const isVideo = asset.kind !== "static_ad";
  const busy = asset.status === "queued" || asset.status === "running";
  // eslint-disable-next-line react-hooks/purity -- server component, rendered per request
  const stale = busy && Date.now() - version > STALE_AFTER_MS;
  const canAct = !busy || stale;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className={`relative ${ASPECT_CLASS[asset.aspectRatio]} bg-zinc-100 dark:bg-zinc-900`}>
        {asset.status === "done" && asset.filePath ? (
          isVideo ? (
            <video
              src={fileUrl(asset.filePath, { version })}
              poster={asset.meta.posterPath ? fileUrl(asset.meta.posterPath, { version }) : undefined}
              controls
              playsInline
              preload="none"
              className="h-full w-full object-cover"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(asset.filePath, { version })} alt="" className="h-full w-full object-cover" />
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <StatusBadge status={asset.status} />
            {busy && !stale && (
              <p className="text-xs text-zinc-500">
                {isVideo ? "Videos take 2–6 minutes" : "Usually under a minute"}
              </p>
            )}
            {stale && <p className="text-xs text-amber-600">No progress for 45+ minutes. You can retry.</p>}
            {asset.error && <p className="line-clamp-6 text-xs text-red-600 dark:text-red-400">{asset.error}</p>}
          </div>
        )}
      </div>

      <div className="space-y-2 p-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">
            {KIND_LABEL[asset.kind]} <span className="text-zinc-500">{asset.aspectRatio}</span>
          </span>
          {asset.status === "done" && asset.filePath && (
            <a href={fileUrl(asset.filePath, { download: true })} className={`ml-auto ${buttonClass("secondary", "sm")}`}>
              Download
            </a>
          )}
        </div>

        {canAct && (
          <div className="flex flex-wrap justify-end gap-1">
            {asset.status === "done" ? (
              <ActionButton
                action={regenerateAsset.bind(null, asset.id, "reuse")}
                title="Redraw text, captions and colors from the saved scene/clips. No AI cost."
              >
                Re-render (free)
              </ActionButton>
            ) : (
              <ActionButton
                action={regenerateAsset.bind(null, asset.id, "reuse")}
                title="Reuses every part that already finished; only missing parts are paid for."
              >
                Retry
              </ActionButton>
            )}
            <ActionButton
              action={regenerateAsset.bind(null, asset.id, "fresh")}
              confirmText={`Generate brand-new ${isVideo ? "footage" : "image"} for about ${formatUsd(freshCostUsd)}?`}
              title="Discards saved scenes/clips and generates new creative (paid)."
            >
              {isVideo ? "New video" : "New image"} ~{formatUsd(freshCostUsd)}
            </ActionButton>
            <ActionButton action={deleteAsset.bind(null, asset.id)} variant="danger" confirmText="Delete this item?">
              Delete
            </ActionButton>
          </div>
        )}
      </div>
    </div>
  );
}
