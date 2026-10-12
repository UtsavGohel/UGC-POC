import Link from "next/link";
import { Suspense } from "react";
import { NewProductForm } from "@/components/new-product-form";
import { StatusBadge } from "@/components/status-badge";
import { getTotalSpendUsd, listProducts } from "@/lib/data";
import { fileUrl, formatUsd } from "@/lib/urls";

export default function HomePage() {
  return (
    <div className="space-y-10">
      <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight">New product</h1>
        <p className="mt-1 mb-6 text-sm text-zinc-500">
          Add a product page URL, photos, or both. AI builds the brand profile and ad angles, then you
          pick what to generate.
        </p>
        <NewProductForm />
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Products</h2>
          <Suspense fallback={null}>
            <TotalSpend />
          </Suspense>
        </div>
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading products…</p>}>
          <ProductList />
        </Suspense>
      </section>
    </div>
  );
}

async function TotalSpend() {
  const total = await getTotalSpendUsd();
  return (
    <p className="text-sm text-zinc-500" title="Includes deleted products">
      Total AI spend: <strong className="text-zinc-900 dark:text-zinc-100">{formatUsd(total)}</strong>
    </p>
  );
}

async function ProductList() {
  const products = await listProducts();
  if (products.length === 0) {
    return <p className="text-sm text-zinc-500">No products yet.</p>;
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((p) => (
        <li key={p.id}>
          <Link
            href={`/products/${p.id}`}
            className="flex gap-3 rounded-xl border border-zinc-200 bg-white p-3 transition hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900">
              {p.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl(p.thumbnail)} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0 space-y-1">
              <p className="truncate font-medium">{p.name}</p>
              <StatusBadge status={p.status} />
              <p className="text-xs text-zinc-500">
                {p.assetCount} assets · {formatUsd(p.costUsd)} spent
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
