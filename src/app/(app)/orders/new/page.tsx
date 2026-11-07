import { ActionForm } from "@/components/ActionForm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { CATEGORY_LABELS } from "@/lib/labels";
import { requireRole } from "@/lib/session";
import { createOrder } from "../actions";

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const { product: productId } = await searchParams;

  // 1. adım: ürün seçimi
  if (!productId) {
    const products = await prisma.productType.findMany({
      where: { active: true },
      include: { _count: { select: { components: true, processes: true } } },
      orderBy: { name: "asc" },
    });
    return (
      <>
        <PageHeader title="Yeni Üretim Siparişi" subtitle="1. adım: Ürün seçin" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <Link key={p.id} href={`/orders/new?product=${p.id}`} className="card card-pad transition hover:border-indigo-400 hover:shadow-md">
              <div className="text-lg font-semibold">{p.name}</div>
              <div className="text-sm text-slate-500">{p.description}</div>
              <div className="mt-3 text-xs text-slate-500">
                {p._count.components} parça · {p._count.processes} işlem adımı
              </div>
            </Link>
          ))}
        </div>
      </>
    );
  }

  // 2. adım: sipariş bilgileri ve parçalar
  const product = await prisma.productType.findUnique({
    where: { id: productId },
    include: { components: { orderBy: { sortOrder: "asc" } } },
  });
  if (!product) notFound();

  const customers = await prisma.organization.findMany({
    where: { type: "CUSTOMER", ...(s.role === "COMPANY" ? { parentId: s.orgId ?? "__none__" } : {}) },
    orderBy: { name: "asc" },
  });
  const companies =
    s.role === "DEVELOPER" ? await prisma.organization.findMany({ where: { type: "COMPANY" }, orderBy: { name: "asc" } }) : [];

  return (
    <>
      <PageHeader
        title={`Yeni ${product.name} Siparişi`}
        subtitle={
          <>
            2. adım: Sipariş bilgileri ve gerekli malzemeler ·{" "}
            <Link href="/orders/new" className="text-indigo-600 hover:underline">Ürünü değiştir</Link>
          </>
        }
      />
      <ActionForm action={createOrder} className="space-y-6">
        <input type="hidden" name="productTypeId" value={product.id} />

        <section className="card card-pad">
          <h2 className="mb-4 font-semibold">Sipariş bilgileri</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="label">Model adı *</label>
              <input name="modelName" className="input" required placeholder="örn. Basic Oversize Hoodie" />
            </div>
            <div>
              <label className="label">Toplam adet *</label>
              <input name="quantity" type="number" min={1} className="input" required />
            </div>
            <div>
              <label className="label">Ana renk</label>
              <input name="color" className="input" placeholder="örn. Antrasit" />
            </div>
            {s.role === "DEVELOPER" && (
              <div>
                <label className="label">Firma *</label>
                <select name="companyId" className="input" required>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="label">Müşteri</label>
              <select name="customerId" className="input">
                <option value="">— Seçiniz —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Termin tarihi</label>
              <input name="dueDate" type="date" className="input" />
            </div>
          </div>

          <div className="mt-4">
            <div className="label">Beden dağılımı (adet)</div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {SIZES.map((size) => (
                <div key={size}>
                  <div className="text-center text-xs font-medium text-slate-500">{size}</div>
                  <input name={`size_${size}`} type="number" min={0} className="input text-center" />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <label className="label">Notlar</label>
            <textarea name="notes" rows={2} className="input" />
          </div>
        </section>

        <section className="card overflow-x-auto">
          <div className="card-pad pb-3">
            <h2 className="font-semibold">Malzemeler ve parçalar</h2>
            <p className="text-sm text-slate-500">
              Bu üründe kullanılacak parçaları işaretleyin ve detaylarını girin. Miktar boş bırakılırsa sipariş adedi × birim tüketimden otomatik hesaplanır.
            </p>
          </div>
          <table className="w-full min-w-[860px]">
            <thead className="border-y border-slate-200 bg-slate-50">
              <tr>
                <th className="th w-10"></th>
                <th className="th">Parça</th>
                <th className="th">Özellik / Detay</th>
                <th className="th w-32">Renk</th>
                <th className="th w-36">Tedarikçi</th>
                <th className="th w-32">Miktar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {product.components.map((c) => (
                <tr key={c.id}>
                  <td className="td">
                    <input type="checkbox" name={`comp_${c.id}_on`} defaultChecked={c.required} className="h-4 w-4 accent-indigo-600" />
                  </td>
                  <td className="td">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-slate-500">{CATEGORY_LABELS[c.category]}{!c.required && " · opsiyonel"}</div>
                  </td>
                  <td className="td"><input name={`comp_${c.id}_spec`} defaultValue={c.defaultSpec ?? ""} className="input" /></td>
                  <td className="td"><input name={`comp_${c.id}_color`} className="input" /></td>
                  <td className="td"><input name={`comp_${c.id}_supplier`} className="input" /></td>
                  <td className="td">
                    <div className="flex items-center gap-1">
                      <input name={`comp_${c.id}_qty`} inputMode="decimal" className="input" placeholder={c.perUnitQty ? `${c.perUnitQty}/adet` : ""} />
                      <span className="text-xs text-slate-500">{c.defaultUnit}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="card-pad border-t border-slate-200">
            <h3 className="mb-2 text-sm font-semibold">Ek parça (şablonda olmayan)</h3>
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_160px_2fr]">
                  <input name={`extra_${i}_name`} className="input" placeholder="Parça adı" />
                  <select name={`extra_${i}_category`} className="input" defaultValue="TRIM">
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                  <input name={`extra_${i}_spec`} className="input" placeholder="Detay" />
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="flex justify-end gap-2">
          <Link href="/orders" className="btn">Vazgeç</Link>
          <button className="btn-primary">Siparişi oluştur</button>
        </div>
      </ActionForm>
    </>
  );
}
