import Link from "next/link";
import type { Currency } from "@prisma/client";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatDate, today } from "@/lib/labels";
import { orderProgress } from "@/lib/progress";
import { LINE_STATUS, LINE_STATUSES, money, num, sizeSummary } from "@/lib/sales";
import { querySalesLines, type SalesFilters } from "@/lib/salesQuery";
import { requireRole } from "@/lib/session";

function MoneyList({ values }: { values: Partial<Record<Currency, number>> }) {
  const entries = Object.entries(values) as [Currency, number][];
  if (!entries.length) return <span>—</span>;
  return (
    <>
      {entries.map(([c, v]) => (
        <div key={c}>{money(v, c)}</div>
      ))}
    </>
  );
}

export default async function SalesListPage({ searchParams }: { searchParams: Promise<SalesFilters> }) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const f = await searchParams;
  const [{ rows, totals, orderCount }, customers] = await Promise.all([
    querySalesLines(s, f),
    prisma.organization.findMany({
      where: { type: "CUSTOMER", ...(s.role === "COMPANY" ? { parentId: s.orgId ?? "__none__" } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const remaining: Partial<Record<Currency, number>> = {};
  for (const [c, v] of Object.entries(totals.amount) as [Currency, number][]) remaining[c] = v - (totals.received[c] ?? 0);
  const exportQs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const todayTs = today().getTime();

  // Aynı siparişin satırlarını görsel olarak gruplamak için
  let lastOrder = "";
  let band = false;

  return (
    <>
      <PageHeader
        title="Sipariş Listesi"
        subtitle={`${orderCount} sipariş · ${rows.length} satır`}
        actions={
          <>
            <Link href="/sales/import" className="btn">Excel&apos;den aktar</Link>
            <a href={`/sales/export${exportQs ? `?${exportQs}` : ""}`} className="btn">Excel&apos;e indir</a>
            <Link href="/sales/new" className="btn-primary">+ Yeni sipariş</Link>
          </>
        }
      />

      {/* Filtreler */}
      <form className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
        <div>
          <label className="label">Ara</label>
          <input name="q" defaultValue={f.q} className="input" placeholder="Model, renk, kumaş, sipariş kodu, müşteri…" />
        </div>
        <div>
          <label className="label">Müşteri</label>
          <select name="customer" defaultValue={f.customer ?? ""} className="input">
            <option value="">Tümü</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Durum</label>
          <select name="status" defaultValue={f.status ?? ""} className="input">
            <option value="">Tümü</option>
            <option value="open">Açık (alındı + üretimde)</option>
            {LINE_STATUSES.map((st) => (
              <option key={st} value={st}>{LINE_STATUS[st].label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Sipariş tarihi (başlangıç)</label>
          <input type="date" name="from" defaultValue={f.from} className="input" />
        </div>
        <div>
          <label className="label">Sipariş tarihi (bitiş)</label>
          <input type="date" name="to" defaultValue={f.to} className="input" />
        </div>
        <div className="flex items-end gap-2">
          <button className="btn-primary">Filtrele</button>
          <Link href="/sales" className="btn">Temizle</Link>
        </div>
      </form>

      {/* Özet */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="card card-pad">
          <div className="text-xs text-slate-500">Toplam adet</div>
          <div className="text-xl font-semibold tabular-nums">{num(totals.qty)}</div>
          <div className="text-xs text-slate-500">Yüklenen: {num(totals.shippedQty)}</div>
        </div>
        <div className="card card-pad">
          <div className="text-xs text-slate-500">Sipariş tutarı</div>
          <div className="text-lg font-semibold tabular-nums"><MoneyList values={totals.amount} /></div>
        </div>
        <div className="card card-pad">
          <div className="text-xs text-slate-500">Yüklenen tutar</div>
          <div className="text-lg font-semibold tabular-nums"><MoneyList values={totals.shipped} /></div>
        </div>
        <div className="card card-pad">
          <div className="text-xs text-slate-500">Alınan bedel</div>
          <div className="text-lg font-semibold tabular-nums text-emerald-700"><MoneyList values={totals.received} /></div>
        </div>
        <div className="card card-pad">
          <div className="text-xs text-slate-500">Kalan (tutar − alınan)</div>
          <div className="text-lg font-semibold tabular-nums text-amber-700"><MoneyList values={remaining} /></div>
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty>
          Bu filtrede sipariş yok. <Link href="/sales/new" className="text-indigo-600 underline">Yeni sipariş</Link> ekleyebilir ya da
          Excel&apos;den aktarabilirsiniz.
        </Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[1600px] text-sm">
            <thead className="sticky top-0 border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Durum</th>
                <th className="th">Sip. tarihi</th>
                <th className="th">Sip. kodu</th>
                <th className="th">Müşteri</th>
                <th className="th">Müş. sip. no</th>
                <th className="th">Model</th>
                <th className="th">Renk</th>
                <th className="th">Kumaş</th>
                <th className="th">Set</th>
                <th className="th">Bedenler</th>
                <th className="th text-right">Adet</th>
                <th className="th">Termin</th>
                <th className="th text-right">Fiyat</th>
                <th className="th text-right">Tutar</th>
                <th className="th text-right">Yüklenen</th>
                <th className="th text-right">Y. tutar</th>
                <th className="th">Üretim</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const so = r.salesOrder;
                if (so.id !== lastOrder) {
                  band = !band;
                  lastOrder = so.id;
                }
                const late = r.deliveryDate && r.deliveryDate.getTime() < todayTs && (r.status === "RECEIVED" || r.status === "IN_PRODUCTION");
                const partial = r.totals.shippedQty > 0 && r.totals.shippedQty < r.totals.qty;
                return (
                  <tr key={r.id} className={`border-b border-slate-100 ${band ? "bg-white" : "bg-slate-50/60"} ${r.status === "CANCELLED" ? "opacity-50" : ""}`}>
                    <td className="td"><Badge tone={LINE_STATUS[r.status].tone}>{LINE_STATUS[r.status].label}</Badge></td>
                    <td className="td whitespace-nowrap">{formatDate(so.orderDate)}</td>
                    <td className="td whitespace-nowrap">
                      <Link href={`/sales/${so.id}`} className="font-medium text-indigo-700 hover:underline">{so.code}</Link>
                    </td>
                    <td className="td">{so.customer.name}</td>
                    <td className="td">{so.customerOrderNo ?? "—"}</td>
                    <td className="td font-medium">{r.model}</td>
                    <td className="td">{r.color ?? "—"}</td>
                    <td className="td max-w-[220px] truncate" title={r.fabric ?? ""}>{r.fabric ?? "—"}</td>
                    <td className="td">{r.sizeSet?.code ?? "—"}</td>
                    <td className="td whitespace-nowrap text-xs text-slate-600">{sizeSummary(r.quantities, r.sizeSet?.sizes) || "—"}</td>
                    <td className="td text-right font-medium tabular-nums">{num(r.totals.qty)}</td>
                    <td className={`td whitespace-nowrap ${late ? "font-semibold text-red-600" : ""}`}>{formatDate(r.deliveryDate)}</td>
                    <td className="td text-right tabular-nums">{r.unitPrice != null ? money(r.unitPrice, so.currency) : "—"}</td>
                    <td className="td text-right tabular-nums">{money(r.totals.amount, so.currency)}</td>
                    <td className={`td text-right tabular-nums ${partial ? "text-amber-700" : ""}`}>{r.totals.shippedQty ? num(r.totals.shippedQty) : "—"}</td>
                    <td className="td text-right tabular-nums">{r.totals.shippedQty ? money(r.totals.shippedAmount, so.currency) : "—"}</td>
                    <td className="td whitespace-nowrap">
                      {r.productionOrder ? (
                        <Link href={`/orders/${r.productionOrder.id}`} className="text-xs text-indigo-700 hover:underline">
                          {r.productionOrder.code} · %{orderProgress(r.productionOrder.tasks)}
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
