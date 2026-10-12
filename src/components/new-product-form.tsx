"use client";

import { useActionState, useState } from "react";
import { createProduct, type FormState } from "@/app/actions";
import { SubmitButton } from "./ui";

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900";

export function NewProductForm() {
  const [state, action] = useActionState<FormState, FormData>(createProduct, {});
  const [previews, setPreviews] = useState<string[]>([]);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Product name *</span>
          <input name="name" required maxLength={120} placeholder="Hydrating Face Serum" className={inputClass} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Product page URL</span>
          <input name="url" type="url" placeholder="https://brand.com/products/serum" className={inputClass} />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Short description (optional)</span>
        <textarea
          name="description"
          rows={3}
          maxLength={4000}
          placeholder="Who it's for, key benefits, price, anything the AI should know"
          className={inputClass}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Product photos (1–5, clean shots work best)</span>
        <input
          name="images"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-medium dark:file:bg-zinc-800"
          onChange={(e) => {
            previews.forEach(URL.revokeObjectURL);
            setPreviews(Array.from(e.target.files ?? []).slice(0, 5).map((f) => URL.createObjectURL(f)));
          }}
        />
      </label>
      {previews.length > 0 && (
        <div className="flex gap-2">
          {previews.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" className="h-20 w-20 rounded-lg border object-cover dark:border-zinc-700" />
          ))}
        </div>
      )}

      {state.error && <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>}

      <SubmitButton pendingText="Uploading…">Analyze product</SubmitButton>
    </form>
  );
}
