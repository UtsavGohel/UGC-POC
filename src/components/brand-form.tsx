"use client";

import { useActionState } from "react";
import { updateBrand, type FormState } from "@/app/actions";
import type { BrandProfile } from "@/lib/db/schema";
import { SubmitButton } from "./ui";

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900";

export function BrandForm({ productId, brand }: { productId: string; brand: BrandProfile }) {
  const [state, action] = useActionState<FormState, FormData>(updateBrand.bind(null, productId), {});

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Brand name" name="brandName" defaultValue={brand.brandName} />
        <Field label="Product name" name="productName" defaultValue={brand.productName} />
      </div>
      <Field label="One-liner" name="oneLiner" defaultValue={brand.oneLiner} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Target audience" name="targetAudience" defaultValue={brand.targetAudience} />
        <Field label="Tone of voice" name="tone" defaultValue={brand.tone} />
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-zinc-500">Benefits (one per line)</span>
        <textarea name="benefits" rows={4} defaultValue={brand.benefits.join("\n")} className={inputClass} />
      </label>
      <div className="flex flex-wrap items-end gap-4">
        <ColorField label="Primary color" name="primary" defaultValue={brand.colors.primary} />
        <ColorField label="Accent color" name="secondary" defaultValue={brand.colors.secondary} />
        <div className="ml-auto flex items-center gap-3">
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state.message && <p className="text-sm text-emerald-700 dark:text-emerald-400">{state.message}</p>}
          <SubmitButton variant="secondary" size="sm" pendingText="Saving…">
            Save brand
          </SubmitButton>
        </div>
      </div>
      <p className="text-xs text-zinc-500">
        Changes apply to new generations. Click “Re-render (free)” on an existing ad to apply them there at no AI cost.
      </p>
    </form>
  );
}

function Field({ label, name, defaultValue }: { label: string; name: string; defaultValue: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      <input name={name} defaultValue={defaultValue} className={inputClass} />
    </label>
  );
}

function ColorField({ label, name, defaultValue }: { label: string; name: string; defaultValue: string }) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="color"
        name={name}
        defaultValue={defaultValue}
        className="h-9 w-12 cursor-pointer rounded border border-zinc-300 dark:border-zinc-700"
      />
      <span className="text-xs font-medium text-zinc-500">{label}</span>
    </label>
  );
}
