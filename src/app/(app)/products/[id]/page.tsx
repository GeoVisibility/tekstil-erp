import Link from "next/link";
import { notFound } from "next/navigation";
import type { ComponentCategory } from "@prisma/client";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { CATEGORY_LABELS } from "@/lib/labels";
import { requireRole } from "@/lib/session";
import {
  addComponent,
  addProcess,
  deleteComponentTemplate,
  deleteProcess,
  move,
  updateComponentTemplate,
  updateProcess,
  updateProduct,
} from "../actions";

const CATS = Object.entries(CATEGORY_LABELS) as [ComponentCategory, string][];

function MoveButtons({ kind, id, first, last }: { kind: "component" | "process"; id: string; first: boolean; last: boolean }) {
  return (
    <div className="flex flex-col">
      {(["up", "down"] as const).map((dir) => (
        <form key={dir} action={move}>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="dir" value={dir} />
          <button
            className="px-1 text-xs leading-4 text-slate-400 hover:text-indigo-600 disabled:opacity-20"
            disabled={dir === "up" ? first : last}
            title={dir === "up" ? "Yukarı taşı" : "Aşağı taşı"}
          >
            {dir === "up" ? "▲" : "▼"}
          </button>
        </form>
      ))}
    </div>
  );
}

function CategoryChecks({ form, selected }: { form?: string; selected: ComponentCategory[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {CATS.map(([k, v]) => (
        <label key={k} className="flex items-center gap-1 text-xs">
          <input type="checkbox" name="cat" value={k} form={form} defaultChecked={selected.includes(k)} className="accent-indigo-600" />
          {v}
        </label>
      ))}
    </div>
  );
}

export default async function ProductEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireRole("DEVELOPER", "COMPANY");
  const [{ id }, { error }] = await Promise.all([params, searchParams]);

  const product = await prisma.productType.findUnique({
    where: { id },
    include: {
      components: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      processes: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        include: { _count: { select: { tasks: true } } },
      },
      _count: { select: { orders: true } },
    },
  });
  if (!product) notFound();

  return (
    <>
      <PageHeader
        title={product.name}
        subtitle={
          <span className="flex items-center gap-2">
            <Badge>{product.code}</Badge>
            {product._count.orders} siparişte kullanıldı
          </span>
        }
        actions={<Link href="/products" className="btn">← Ürünler</Link>}
      />

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {product._count.orders > 0 && (
        <div className="mb-4 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Parça değişiklikleri yalnızca <b>yeni siparişleri</b> etkiler; mevcut siparişler kendi parça kopyalarını korur.
          İşlem adındaki değişiklikler ise mevcut siparişlerin görevlerinde de görünür.
        </div>
      )}

      {/* Genel bilgiler */}
      <form
        key={`${product.name}|${product.description}|${product.active}`}
        action={updateProduct}
        className="card card-pad mb-6 grid items-end gap-3 sm:grid-cols-[1fr_2fr_auto_auto]"
      >
        <input type="hidden" name="productId" value={product.id} />
        <div>
          <label className="label">Ürün adı</label>
          <input name="name" defaultValue={product.name} className="input" required minLength={2} />
        </div>
        <div>
          <label className="label">Açıklama</label>
          <input name="description" defaultValue={product.description ?? ""} className="input" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={product.active} className="h-4 w-4 accent-indigo-600" />
          Aktif (siparişte seçilebilir)
        </label>
        <button className="btn-primary">Kaydet</button>
      </form>

      {/* Parçalar */}
      <section className="card mb-6 overflow-x-auto">
        <div className="card-pad pb-3">
          <h2 className="font-semibold">Parçalar ({product.components.length})</h2>
          <p className="text-sm text-slate-500">
            Yeni siparişte gelen varsayılan malzeme listesi. <b>Birim tüketim</b>: 1 ürün için gereken miktar (miktar otomatik hesaplanır).
          </p>
        </div>
        <table className="w-full min-w-[1000px]">
          <thead className="border-y border-slate-200 bg-slate-50">
            <tr>
              <th className="th w-8"></th>
              <th className="th">Parça adı</th>
              <th className="th w-36">Kategori</th>
              <th className="th">Varsayılan özellik</th>
              <th className="th w-24">Birim</th>
              <th className="th w-28">Birim tüketim</th>
              <th className="th w-20 text-center">Zorunlu</th>
              <th className="th w-36"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {product.components.map((c, i) => {
              const f = `c-${c.id}`;
              return (
                <tr key={`${c.id}|${c.name}|${c.category}|${c.defaultSpec}|${c.defaultUnit}|${c.perUnitQty}|${c.required}`}>
                  <td className="td">
                    <MoveButtons kind="component" id={c.id} first={i === 0} last={i === product.components.length - 1} />
                  </td>
                  <td className="td"><input form={f} name="name" defaultValue={c.name} className="input" required /></td>
                  <td className="td">
                    <select form={f} name="category" defaultValue={c.category} className="input">
                      {CATS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td className="td"><input form={f} name="defaultSpec" defaultValue={c.defaultSpec ?? ""} className="input" /></td>
                  <td className="td"><input form={f} name="defaultUnit" defaultValue={c.defaultUnit ?? ""} className="input" placeholder="adet" /></td>
                  <td className="td"><input form={f} name="perUnitQty" defaultValue={c.perUnitQty ?? ""} inputMode="decimal" className="input" /></td>
                  <td className="td text-center">
                    <input form={f} type="checkbox" name="required" defaultChecked={c.required} className="mt-2.5 h-4 w-4 accent-indigo-600" />
                  </td>
                  <td className="td">
                    <div className="flex justify-end gap-1 pt-1">
                      <form id={f} action={updateComponentTemplate}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className="btn btn-xs">Kaydet</button>
                      </form>
                      <form action={deleteComponentTemplate}>
                        <input type="hidden" name="id" value={c.id} />
                        <ConfirmButton message={`"${c.name}" parçası silinsin mi?`}>Sil</ConfirmButton>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {product.components.length === 0 && <div className="p-5"><Empty>Henüz parça yok.</Empty></div>}

        <form
          key={`add-c-${product.components.length}`}
          action={addComponent}
          className="card-pad grid items-end gap-2 border-t border-slate-200 bg-slate-50/60 sm:grid-cols-2 lg:grid-cols-[1.2fr_150px_2fr_90px_110px_auto_auto]"
        >
          <input type="hidden" name="productId" value={product.id} />
          <div>
            <label className="label">Yeni parça *</label>
            <input name="name" className="input" required placeholder="örn. Cep astarı" />
          </div>
          <div>
            <label className="label">Kategori</label>
            <select name="category" className="input" defaultValue="TRIM">
              {CATS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Varsayılan özellik</label>
            <input name="defaultSpec" className="input" />
          </div>
          <div>
            <label className="label">Birim</label>
            <input name="defaultUnit" className="input" placeholder="adet" />
          </div>
          <div>
            <label className="label">Birim tüketim</label>
            <input name="perUnitQty" inputMode="decimal" className="input" />
          </div>
          <label className="flex items-center gap-1.5 pb-2 text-sm">
            <input type="checkbox" name="required" defaultChecked className="h-4 w-4 accent-indigo-600" />
            Zorunlu
          </label>
          <button className="btn-primary">Ekle</button>
        </form>
      </section>

      {/* İşlemler */}
      <section className="card overflow-x-auto">
        <div className="card-pad pb-3">
          <h2 className="font-semibold">Üretim işlem sırası ({product.processes.length})</h2>
          <p className="text-sm text-slate-500">
            &quot;Planı otomatik oluştur&quot; bu sırayı ve süreleri kullanır. Kategori seçilirse işlem o kategorideki <b>her parça için ayrı</b> görev olur;
            seçilmezse <b>ürünün tamamı</b> için tek görev olur.
          </p>
        </div>
        <table className="w-full min-w-[900px]">
          <thead className="border-y border-slate-200 bg-slate-50">
            <tr>
              <th className="th w-8"></th>
              <th className="th w-10">#</th>
              <th className="th w-64">İşlem adı</th>
              <th className="th w-24">Süre (gün)</th>
              <th className="th">Uygulandığı parça kategorileri</th>
              <th className="th w-36"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {product.processes.map((p, i) => {
              const f = `p-${p.id}`;
              return (
                <tr key={`${p.id}|${p.name}|${p.defaultDurationDays}|${p.componentCategories.join(",")}`}>
                  <td className="td">
                    <MoveButtons kind="process" id={p.id} first={i === 0} last={i === product.processes.length - 1} />
                  </td>
                  <td className="td pt-4 font-semibold text-slate-400">{i + 1}</td>
                  <td className="td"><input form={f} name="name" defaultValue={p.name} className="input" required /></td>
                  <td className="td"><input form={f} name="days" type="number" min={1} defaultValue={p.defaultDurationDays} className="input" /></td>
                  <td className="td pt-3.5"><CategoryChecks form={f} selected={p.componentCategories} /></td>
                  <td className="td">
                    <div className="flex justify-end gap-1 pt-1">
                      <form id={f} action={updateProcess}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="btn btn-xs">Kaydet</button>
                      </form>
                      <form action={deleteProcess}>
                        <input type="hidden" name="id" value={p.id} />
                        {p._count.tasks > 0 ? (
                          <button type="button" disabled className="btn btn-xs" title={`${p._count.tasks} görevde kullanılıyor`}>Sil</button>
                        ) : (
                          <ConfirmButton message={`"${p.name}" işlemi silinsin mi?`}>Sil</ConfirmButton>
                        )}
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {product.processes.length === 0 && <div className="p-5"><Empty>Henüz işlem yok.</Empty></div>}

        <form
          key={`add-p-${product.processes.length}`}
          action={addProcess}
          className="card-pad grid items-end gap-3 border-t border-slate-200 bg-slate-50/60 sm:grid-cols-[1fr_110px] lg:grid-cols-[260px_110px_1fr_auto]"
        >
          <input type="hidden" name="productId" value={product.id} />
          <div>
            <label className="label">Yeni işlem *</label>
            <input name="name" className="input" required placeholder="örn. Yıkama" />
          </div>
          <div>
            <label className="label">Süre (gün)</label>
            <input name="days" type="number" min={1} defaultValue={1} className="input" />
          </div>
          <div className="pb-2.5">
            <div className="label">Kategoriler (boş = ürünün tamamı)</div>
            <CategoryChecks selected={[]} />
          </div>
          <button className="btn-primary">Ekle</button>
        </form>
      </section>
    </>
  );
}
