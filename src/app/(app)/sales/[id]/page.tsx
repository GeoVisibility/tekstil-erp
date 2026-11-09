import Link from "next/link";
import { notFound } from "next/navigation";
import type { Currency } from "@prisma/client";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmButton } from "@/components/ConfirmButton";
import { SalesLinesSection } from "@/components/sales/SalesForms";
import { Badge, PageHeader, ProgressBar } from "@/components/ui";
import { prisma } from "@/lib/db";
import { ORDER_STATUS, formatDate, toInputDate, today } from "@/lib/labels";
import { orderProgress } from "@/lib/progress";
import { CURRENCIES, LINE_STATUS, lineTotals, money, num } from "@/lib/sales";
import { salesScope } from "@/lib/scope";
import { requireRole } from "@/lib/session";
import { addPayment, addShipment, deletePayment, deleteSalesOrder, deleteShipment, openProduction, updateSalesHeader } from "../actions";

export default async function SalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const { id } = await params;

  const order = await prisma.salesOrder.findFirst({
    where: { AND: [{ id }, salesScope(s)] },
    include: {
      customer: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
      payments: { orderBy: { date: "asc" } },
      lines: {
        orderBy: { sortOrder: "asc" },
        include: {
          sizeSet: true,
          shipments: { orderBy: { date: "asc" } },
          productionOrder: { select: { id: true, code: true, status: true, tasks: { select: { status: true } } } },
        },
      },
    },
  });
  if (!order) notFound();

  const [customers, sizeSets, productTypes] = await Promise.all([
    prisma.organization.findMany({
      where: { type: "CUSTOMER", parentId: order.companyId, OR: [{ active: true }, { id: order.customerId }] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.sizeSet.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.productType.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const cur = order.currency;
  const lines = order.lines.map((l) => {
    const unitPrice = l.unitPrice != null ? Number(l.unitPrice) : null;
    return { ...l, unitPrice, totals: lineTotals({ ...l, unitPrice }) };
  });
  const totalQty = lines.reduce((a, l) => a + l.totals.qty, 0);
  const shippedQty = lines.reduce((a, l) => a + l.totals.shippedQty, 0);
  const amount = lines.reduce((a, l) => a + (l.totals.amount ?? 0), 0);
  const shippedAmount = lines.reduce((a, l) => a + (l.totals.shippedAmount ?? 0), 0);
  const payments = order.payments.map((p) => ({ ...p, amount: Number(p.amount), rate: p.rate != null ? Number(p.rate) : null }));
  const receivedSame = payments.filter((p) => p.currency === cur).reduce((a, p) => a + p.amount, 0);
  const otherCurrencyPayments = payments.filter((p) => p.currency !== cur);
  const receivedTL = payments.reduce((a, p) => a + (p.rate != null ? p.amount * p.rate : 0), 0);
  const todayStr = toInputDate(today());

  return (
    <>
      <PageHeader
        title={`${order.code} · ${order.customer.name}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{formatDate(order.orderDate)}</span>
            {order.customerOrderNo && <span>· Müşteri sip. no: {order.customerOrderNo}</span>}
            <span>· {cur}</span>
            {s.role === "DEVELOPER" && <span>· {order.company.name}</span>}
          </span>
        }
        actions={
          <>
            <Link href="/sales" className="btn">← Sipariş listesi</Link>
            <ActionForm action={deleteSalesOrder}>
              <input type="hidden" name="id" value={order.id} />
              <ConfirmButton
                className="btn text-red-600"
                message={`${order.code} siparişi; satırları, sevkiyatları ve tahsilatlarıyla birlikte kalıcı olarak silinsin mi? Bağlı üretim takipleri silinmez. Bu işlem geri alınamaz.`}
              >
                Siparişi sil
              </ConfirmButton>
            </ActionForm>
          </>
        }
      />

      {/* Özet */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="card card-pad">
          <div className="text-xs text-slate-500">Toplam adet</div>
          <div className="text-xl font-semibold tabular-nums">{num(totalQty)}</div>
          <ProgressBar value={totalQty ? Math.min(100, Math.round((shippedQty / totalQty) * 100)) : 0} className="mt-1" />
          <div className="text-xs text-slate-500">Yüklenen: {num(shippedQty)}</div>
        </div>
        <div className="card card-pad">
          <div className="text-xs text-slate-500">Sipariş tutarı</div>
          <div className="text-lg font-semibold tabular-nums">{money(amount, cur)}</div>
        </div>
        <div className="card card-pad">
          <div className="text-xs text-slate-500">Yüklenen tutar</div>
          <div className="text-lg font-semibold tabular-nums">{money(shippedAmount, cur)}</div>
        </div>
        <div className="card card-pad">
          <div className="text-xs text-slate-500">Alınan bedel</div>
          <div className="text-lg font-semibold tabular-nums text-emerald-700">{money(receivedSame, cur)}</div>
          {otherCurrencyPayments.length > 0 && <div className="text-xs text-slate-500">+ farklı dövizde {otherCurrencyPayments.length} tahsilat</div>}
          {receivedTL > 0 && <div className="text-xs text-slate-500">TL karşılığı: {money(receivedTL, "TRY")}</div>}
        </div>
        <div className="card card-pad">
          <div className="text-xs text-slate-500">Kalan</div>
          <div className="text-lg font-semibold tabular-nums text-amber-700">{money(amount - receivedSame, cur)}</div>
        </div>
      </div>

      {/* Başlık bilgileri */}
      <details className="card mb-6">
        <summary className="card-pad cursor-pointer font-semibold">Sipariş bilgilerini düzenle</summary>
        <ActionForm
          key={`${order.code}|${order.customerId}|${order.customerOrderNo}|${order.orderDate.toISOString()}|${order.currency}|${order.notes}`}
          action={updateSalesHeader}
          className="grid gap-4 border-t border-slate-200 p-5 sm:grid-cols-2 lg:grid-cols-6"
        >
          <input type="hidden" name="id" value={order.id} />
          <div>
            <label className="label">Sipariş kodu</label>
            <input name="code" defaultValue={order.code} className="input" required />
          </div>
          <div className="lg:col-span-2">
            <label className="label">Müşteri</label>
            <select name="customerId" defaultValue={order.customerId} className="input">
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Müşteri sip. no</label>
            <input name="customerOrderNo" defaultValue={order.customerOrderNo ?? ""} className="input" />
          </div>
          <div>
            <label className="label">Sipariş tarihi</label>
            <input type="date" name="orderDate" defaultValue={toInputDate(order.orderDate)} className="input" required />
          </div>
          <div>
            <label className="label">Döviz</label>
            <select name="currency" defaultValue={cur} className="input">
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-5">
            <label className="label">Not</label>
            <input name="notes" defaultValue={order.notes ?? ""} className="input" />
          </div>
          <div className="flex items-end">
            <button className="btn-primary w-full">Kaydet</button>
          </div>
        </ActionForm>
      </details>

      {/* Satırlar */}
      <SalesLinesSection
        orderId={order.id}
        currency={cur}
        sizeSets={sizeSets.map((x) => ({ id: x.id, code: x.code, name: x.name, sizes: x.sizes }))}
        lines={order.lines.map((l) => ({
          key: l.id,
          id: l.id,
          model: l.model,
          color: l.color ?? "",
          fabric: l.fabric ?? "",
          sizeSetId: l.sizeSetId ?? "",
          quantities: l.quantities.map((q) => (q ? String(q) : "")),
          deliveryDate: toInputDate(l.deliveryDate),
          unitPrice: l.unitPrice != null ? String(Number(l.unitPrice)) : "",
          status: l.status,
          notes: l.notes ?? "",
          locked: l.shipments.length > 0 || !!l.productionOrderId,
        }))}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Sevkiyat */}
        <section className="card">
          <div className="card-pad pb-3">
            <h2 className="font-semibold">Sevkiyat</h2>
            <p className="text-sm text-slate-500">Kısmi yüklemeler tarihleriyle girilir. Tamamı yüklenen satır otomatik &quot;Yüklendi&quot; olur.</p>
          </div>
          <div className="divide-y divide-slate-100 border-t border-slate-200">
            {lines.filter((l) => l.status !== "CANCELLED").map((l) => {
              const rest = l.totals.qty - l.totals.shippedQty;
              return (
                <div key={l.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium">{l.model}</span>
                      <span className="text-slate-500"> · {l.color ?? "—"}</span>
                    </div>
                    <div className="text-xs tabular-nums text-slate-600">
                      {num(l.totals.shippedQty)} / {num(l.totals.qty)} yüklendi
                      {rest > 0 ? <span className="text-amber-700"> · kalan {num(rest)}</span> : <span className="text-emerald-700"> · tamam</span>}
                    </div>
                  </div>
                  {l.shipments.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {l.shipments.map((sh) => (
                        <li key={sh.id} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-xs">
                          <span>
                            {formatDate(sh.date)} · <b>{num(sh.quantity)}</b> adet{sh.note && <span className="text-slate-500"> · {sh.note}</span>}
                          </span>
                          <ActionForm action={deleteShipment}>
                            <input type="hidden" name="id" value={sh.id} />
                            <ConfirmButton message="Bu sevkiyat kaydı silinsin mi?" className="text-red-600 hover:underline">Sil</ConfirmButton>
                          </ActionForm>
                        </li>
                      ))}
                    </ul>
                  )}
                  {rest > 0 && (
                    <ActionForm key={`${l.id}-${l.shipments.length}`} action={addShipment} className="mt-2 flex flex-wrap items-center gap-1">
                      <input type="hidden" name="lineId" value={l.id} />
                      <input type="date" name="date" defaultValue={todayStr} className="input-sm" required />
                      <input name="quantity" type="number" min={1} defaultValue={rest} className="input-sm w-20" required title="Adet" />
                      <input name="note" placeholder="Not (opsiyonel)" className="input-sm w-40" />
                      <button className="btn btn-xs">+ Sevkiyat ekle</button>
                    </ActionForm>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <div className="space-y-6">
          {/* Üretim takibi */}
          <section className="card">
            <div className="card-pad pb-3">
              <h2 className="font-semibold">Üretim takibi</h2>
              <p className="text-sm text-slate-500">Satırı üretime açınca parça, görev ve aşama takibi başlar.</p>
            </div>
            <div className="divide-y divide-slate-100 border-t border-slate-200">
              {lines.filter((l) => l.status !== "CANCELLED").map((l) => (
                <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div>
                    <span className="font-medium">{l.model}</span>
                    <span className="text-slate-500"> · {l.color ?? "—"} · {num(l.totals.qty)} adet</span>
                    <span className="ml-2"><Badge tone={LINE_STATUS[l.status].tone}>{LINE_STATUS[l.status].label}</Badge></span>
                  </div>
                  {l.productionOrder ? (
                    <Link href={`/orders/${l.productionOrder.id}`} className="flex items-center gap-2 text-sm text-indigo-700 hover:underline">
                      {l.productionOrder.code}
                      <Badge tone={ORDER_STATUS[l.productionOrder.status].tone}>{ORDER_STATUS[l.productionOrder.status].label}</Badge>
                      <span className="text-xs">%{orderProgress(l.productionOrder.tasks)}</span>
                    </Link>
                  ) : productTypes.length ? (
                    <ActionForm action={openProduction} className="flex items-center gap-1">
                      <input type="hidden" name="lineId" value={l.id} />
                      <select name="productTypeId" className="input-sm" title="Ürün tipi (parça ve işlem şablonu)">
                        {productTypes.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <button className="btn btn-xs">Üretime aç</button>
                    </ActionForm>
                  ) : (
                    <Link href="/products" className="text-xs text-indigo-700 underline">Önce ürün tanımı ekleyin</Link>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Tahsilat */}
          <section className="card">
            <div className="card-pad pb-3">
              <h2 className="font-semibold">Tahsilat</h2>
              <p className="text-sm text-slate-500">Alınan bedeller. Kur girilirse TL karşılığı hesaplanır.</p>
            </div>
            {payments.length > 0 && (
              <table className="w-full border-t border-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="th">Tarih</th>
                    <th className="th text-right">Tutar</th>
                    <th className="th text-right">Kur</th>
                    <th className="th text-right">TL karşılığı</th>
                    <th className="th">Not</th>
                    <th className="th"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="td whitespace-nowrap">{formatDate(p.date)}</td>
                      <td className="td text-right tabular-nums">{money(p.amount, p.currency as Currency)}</td>
                      <td className="td text-right tabular-nums">{p.rate != null ? num(p.rate, 4) : "—"}</td>
                      <td className="td text-right tabular-nums">{p.rate != null ? money(p.amount * p.rate, "TRY") : "—"}</td>
                      <td className="td text-xs text-slate-600">{p.note ?? ""}</td>
                      <td className="td text-right">
                        <ActionForm action={deletePayment}>
                          <input type="hidden" name="id" value={p.id} />
                          <ConfirmButton message="Bu tahsilat kaydı silinsin mi?" className="text-xs text-red-600 hover:underline">Sil</ConfirmButton>
                        </ActionForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <ActionForm
              key={`pay-${payments.length}`}
              action={addPayment}
              className="grid gap-2 border-t border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-[130px_1fr_90px_100px] lg:grid-cols-[130px_1fr_90px_100px_1fr_auto]"
            >
              <input type="hidden" name="salesOrderId" value={order.id} />
              <input type="date" name="date" defaultValue={todayStr} className="input-sm" required title="Tarih" />
              <input name="amount" inputMode="decimal" placeholder="Tutar" className="input-sm" required />
              <select name="currency" defaultValue={cur} className="input-sm">
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <input name="rate" inputMode="decimal" placeholder="Kur (TL)" className="input-sm" />
              <input name="note" placeholder="Not (örn. %50 avans)" className="input-sm" />
              <button className="btn-primary btn-xs">+ Tahsilat ekle</button>
            </ActionForm>
          </section>
        </div>
      </div>
    </>
  );
}
