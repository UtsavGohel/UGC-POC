import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { deleteProduct, reanalyzeProduct } from "@/app/actions";
import { AssetCard } from "@/components/asset-card";
import { BrandForm } from "@/components/brand-form";
import { GenerateForm } from "@/components/generate-form";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/button-class";
import { ActionButton, AutoRefresh } from "@/components/ui";
import { getProductDetail } from "@/lib/data";
import { env } from "@/lib/env";
import { assetCostEstimates, freshAssetCostUsd } from "@/lib/pricing";
import { fileUrl, formatUsd } from "@/lib/urls";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ProductPage({ params }: PageProps<"/products/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading product…</p>}>
      <ProductView params={params} />
    </Suspense>
  );
}

async function ProductView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const detail = await getProductDetail(id);
  if (!detail) notFound();

  const { product, angles, assets, costs, totalCostUsd } = detail;
  const busy =
    product.status === "analyzing" || assets.some((a) => a.status === "queued" || a.status === "running");
  const doneCount = assets.filter((a) => a.status === "done").length;

  return (
    <div className="space-y-8">
      <AutoRefresh active={busy} />

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex gap-2">
          {product.images.map((img) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={img}
              src={fileUrl(img)}
              alt=""
              className="h-20 w-20 rounded-lg border border-zinc-200 object-cover dark:border-zinc-800"
            />
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <Link href="/" className="text-xs text-zinc-500 hover:underline">
            ← All products
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{product.brand?.productName ?? product.name}</h1>
          <div className="flex items-center gap-3 text-sm text-zinc-500">
            <StatusBadge status={product.status} />
            {product.sourceUrl && (
              <a href={product.sourceUrl} target="_blank" rel="noreferrer" className="truncate hover:underline">
                {product.sourceUrl}
              </a>
            )}
          </div>
        </div>
        <div className="flex items-start gap-2">
          {product.status !== "analyzing" && (
            <ActionButton
              action={reanalyzeProduct.bind(null, product.id)}
              title="Rebuilds the brand profile and adds new angles. Angles with generated ads are kept."
            >
              Re-analyze
            </ActionButton>
          )}
          <ActionButton
            action={deleteProduct.bind(null, product.id)}
            variant="danger"
            pendingText="Deleting…"
            confirmText="Delete this product and all its generated ads?"
          >
            Delete
          </ActionButton>
        </div>
      </div>

      {product.status === "analyzing" && (
        <Panel title="Analyzing product">
          <p className="text-sm text-zinc-500">
            Reading the product page and photos, then writing ad angles. This takes about 20–60 seconds.
            {product.brand && " Angles that already have generated ads are kept."}
          </p>
        </Panel>
      )}

      {product.status === "failed" && (
        <Panel title="Analysis failed">
          <p className="text-sm text-red-600 dark:text-red-400">{product.error}</p>
        </Panel>
      )}

      {product.brand && product.status === "ready" && (
        <>
          <Panel title="Brand profile" subtitle={product.brand.oneLiner}>
            <BrandForm productId={product.id} brand={product.brand} />
          </Panel>

          <Panel title="Ad angles" subtitle="Pick angles and output types, then generate.">
            <GenerateForm
              productId={product.id}
              angles={angles}
              estimates={assetCostEstimates()}
              maxBatchUsd={env().MAX_BATCH_USD}
            />
          </Panel>
        </>
      )}

      {assets.length > 0 && (
        <Panel
          title="Generated ads"
          subtitle={`${doneCount} of ${assets.length} ready`}
          action={
            doneCount > 0 ? (
              <a href={`/api/products/${product.id}/download`} className={buttonClass("primary", "sm")}>
                Download all (.zip)
              </a>
            ) : null
          }
        >
          <div className="space-y-8">
            {angles
              .filter((angle) => assets.some((a) => a.angleId === angle.id))
              .map((angle) => (
                <div key={angle.id} className="space-y-3">
                  <h3 className="font-medium">
                    {angle.title} <span className="text-sm font-normal text-zinc-500">— {angle.hook}</span>
                  </h3>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
                    {assets
                      .filter((a) => a.angleId === angle.id)
                      .map((asset) => (
                        <AssetCard key={asset.id} asset={asset} freshCostUsd={freshAssetCostUsd(asset.kind)} />
                      ))}
                  </div>
                </div>
              ))}
          </div>
        </Panel>
      )}

      {costs.length > 0 && (
        <Panel title="AI cost" subtitle={`Total ${formatUsd(totalCostUsd)} for this product`}>
          <table className="w-full max-w-md text-sm">
            <thead className="text-left text-xs text-zinc-500">
              <tr>
                <th className="py-1 font-medium">Operation</th>
                <th className="py-1 text-right font-medium">Calls</th>
                <th className="py-1 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {costs.map((c) => (
                <tr key={c.operation} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1">{c.operation.replaceAll("_", " ")}</td>
                  <td className="py-1 text-right">{c.count}</td>
                  <td className="py-1 text-right">{formatUsd(c.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {subtitle && <p className="text-sm text-zinc-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
