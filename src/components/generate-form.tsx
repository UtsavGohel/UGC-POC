"use client";

import { useActionState, useState } from "react";
import { generateAssets, type FormState } from "@/app/actions";
import type { Angle, Asset } from "@/lib/db/schema";
import type { CostEstimates } from "@/lib/pricing";
import { formatUsd } from "@/lib/urls";
import { CopyButton, SubmitButton } from "./ui";

const KINDS: { kind: Asset["kind"]; label: string; detail: string; perAngle: number }[] = [
  { kind: "static_ad", label: "Static ads", detail: "1:1, 4:5 and 9:16 images", perAngle: 3 },
  { kind: "product_video", label: "Product video", detail: "~12s + end card, voiceover", perAngle: 1 },
  { kind: "ugc_video", label: "UGC avatar video", detail: "~24s creator talking to camera", perAngle: 1 },
];

export function GenerateForm({
  productId,
  angles,
  estimates,
  maxBatchUsd,
}: {
  productId: string;
  angles: Angle[];
  estimates: CostEstimates;
  maxBatchUsd: number;
}) {
  const [state, action] = useActionState<FormState, FormData>(generateAssets.bind(null, productId), {});
  const [selected, setSelected] = useState<Set<string>>(() => new Set(angles.slice(0, 2).map((a) => a.id)));
  const [kinds, setKinds] = useState<Set<Asset["kind"]>>(() => new Set(["static_ad"]));
  const [variants, setVariants] = useState(false);
  const prices = variants ? estimates.fresh : estimates.normal;

  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const estimate = KINDS.filter((k) => kinds.has(k.kind)).reduce(
    (sum, k) => sum + k.perAngle * prices[k.kind] * selected.size,
    0,
  );

  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-3 lg:grid-cols-2">
        {angles.map((angle) => (
          <div
            key={angle.id}
            className={`rounded-xl border p-4 transition ${
              selected.has(angle.id)
                ? "border-zinc-900 ring-1 ring-zinc-900 dark:border-white dark:ring-white"
                : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800"
            }`}
          >
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  name="angleIds"
                  value={angle.id}
                  checked={selected.has(angle.id)}
                  onChange={() => setSelected((s) => toggle(s, angle.id))}
                />
                <span className="font-semibold">{angle.title}</span>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  {angle.type.replaceAll("_", " ")}
                </span>
              </label>
              <div className="min-w-0 space-y-2 pl-7">
                <p className="text-sm">
                  <span className="text-zinc-500">Hook: </span>
                  {angle.hook}
                </p>
                <p className="text-sm">
                  <span className="text-zinc-500">Image: </span>
                  <strong>{angle.headline}</strong> — {angle.subheadline} · <em>{angle.cta}</em>
                </p>
                <details className="text-sm">
                  <summary className="cursor-pointer text-zinc-500">Caption and scripts</summary>
                  <div className="mt-2 space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-zinc-500">Post caption</span>
                        <CopyButton text={angle.caption} />
                      </div>
                      <p className="whitespace-pre-wrap">{angle.caption}</p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-zinc-500">Product video voiceover</span>
                      <p>{angle.voiceover}</p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-zinc-500">
                        UGC script · {angle.ugcScript.persona}, {angle.ugcScript.setting}
                      </span>
                      <ol className="list-decimal pl-5">
                        {angle.ugcScript.lines.map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ol>
                    </div>
                  </div>
                </details>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {KINDS.map((k) => (
          <label
            key={k.kind}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
          >
            <input
              type="checkbox"
              name="kinds"
              value={k.kind}
              checked={kinds.has(k.kind)}
              onChange={() => setKinds((s) => toggle(s, k.kind))}
            />
            <span className="text-sm">
              <span className="font-medium">{k.label}</span>
              <span className="block text-xs text-zinc-500">
                {k.detail} · ~{formatUsd(prices[k.kind] * k.perAngle)}/angle
              </span>
            </span>
          </label>
        ))}
        <label
          className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400"
          title="By default, items that already exist are skipped so a repeat click never pays twice."
        >
          <input
            type="checkbox"
            name="allowDuplicates"
            checked={variants}
            onChange={(e) => setVariants(e.target.checked)}
          />
          New variants (generate again even if it exists)
        </label>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {selected.size} angle{selected.size === 1 ? "" : "s"} · up to <strong>{formatUsd(estimate)}</strong>
            {estimate > maxBatchUsd && (
              <span className="block text-xs text-red-600">Over the {formatUsd(maxBatchUsd)} limit per click</span>
            )}
          </span>
          <SubmitButton
            pendingText="Queuing…"
            disabled={selected.size === 0 || kinds.size === 0 || estimate > maxBatchUsd}
          >
            Generate
          </SubmitButton>
        </div>
      </div>
      {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state.message && <p className="text-sm text-emerald-700 dark:text-emerald-400">{state.message}</p>}
    </form>
  );
}
