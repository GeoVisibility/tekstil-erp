import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { createProduct } from "./actions";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireRole("DEVELOPER", "COMPANY");
  const { error } = await searchParams;
  const products = await prisma.productType.findMany({
    include: { _count: { select: { components: true, processes: true, orders: true } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <>
      <PageHeader title="Ürün Tanımları" subtitle="Ürün tipleri, varsayılan parçaları ve üretim işlem sırası" />
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="grid content-start gap-4 sm:grid-cols-2">
          {products.map((p) => (
            <Link
              key={p.id}
              href={`/products/${p.id}`}
              className={`card card-pad transition hover:border-indigo-400 hover:shadow-md ${p.active ? "" : "opacity-60"}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold">{p.name}</span>
                <Badge>{p.code}</Badge>
                {!p.active && <Badge tone="red">Pasif</Badge>}
              </div>
              {p.description && <div className="mt-1 text-sm text-slate-500">{p.description}</div>}
              <div className="mt-3 flex gap-3 text-xs text-slate-500">
                <span>{p._count.components} parça</span>
                <span>{p._count.processes} işlem</span>
                <span>{p._count.orders} sipariş</span>
              </div>
            </Link>
          ))}
        </div>

        <form action={createProduct} className="card card-pad h-fit space-y-3">
          <h2 className="font-semibold">Yeni ürün tipi</h2>
          <div>
            <label className="label">Ad *</label>
            <input name="name" className="input" required minLength={2} placeholder="örn. Sweatshirt" />
          </div>
          <div>
            <label className="label">Kod * (A-Z, 0-9)</label>
            <input name="code" className="input uppercase" required pattern="[A-Za-z0-9_\-]{2,20}" placeholder="örn. SWEAT" />
          </div>
          <div>
            <label className="label">Açıklama</label>
            <input name="description" className="input" />
          </div>
          <div>
            <label className="label">Parça ve işlemleri kopyala</label>
            <select name="copyFrom" className="input">
              <option value="">— Boş başla —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">Benzer bir üründen başlamak için (örn. Hoodie → Sweatshirt).</p>
          </div>
          <button className="btn-primary w-full">Oluştur ve düzenle</button>
        </form>
      </div>
    </>
  );
}
