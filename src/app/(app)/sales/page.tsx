import Link from "next/link";
import type { Currency } from "@prisma/client";
import { ActionForm } from "@/components/ActionForm";
import { QuickShip } from "@/components/sales/QuickShip";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatDate, toInputDate, today } from "@/lib/labels";
import { orderProgress } from "@/lib/progress";
import { LINE_STATUS, LINE_STATUSES, money, num, sizeSummary } from "@/lib/sales";
import { querySalesLines, type SalesFilters } from "@/lib/salesQuery";
import { requireRole } from "@/lib/session";
import { salesScope } from "@/lib/scope";
import { LINES_WITHOUT_TASKS } from "@/lib/salesProduction";
import { STEP_STYLE, taskHealth } from "@/lib/taskHealth";
import { openMissingProduction } from "./actions";

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
  const [{ rows, totals, orderCount }, customers, missingTasks] = await Promise.all([
    querySalesLines(s, f),
    prisma.organization.findMany({
      where: { type: "CUSTOMER", ...(s.role === "COMPANY" ? { parentId: s.orgId ?? "__none__" } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.salesOrderLine.count({
      where: { ...LINES_WITHOUT_TASKS, salesOrder: salesScope(s) },
    }),
  ]);

  const remaining: Partial<Record<Currency, number>> = {};
  for (const [c, v] of Object.entries(totals.amount) as [Currency, number][]) remaining[c] = v - (totals.received[c] ?? 0);
  const exportQs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const todayDate = today();
  const todayTs = todayDate.getTime();
  const todayStr = toInputDate(todayDate);
  const health = new Map(
    rows.map((r) => [r.id, taskHealth(r.productionOrder?.tasks ?? [], todayTs, r.status === "RECEIVED" || r.status === "IN_PRODUCTION")]),
  );
  const alarmCount = [...health.values()].filter((h) => h?.row === "alarm").length;

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

      {missingTasks > 0 && (
        <ActionForm action={openMissingProduction} className="card card-pad mb-4 flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">
            <b>{missingTasks}</b> açık sipariş satırının henüz görevi yok. Kumaş → Aksesuar → Yardımcı malzeme → Kesim → Dikim → Kutu/Paket
            görevleri, terminden geriye doğru tarihlenerek açılır.
          </p>
          <button className="btn-primary">Görevleri oluştur</button>
        </ActionForm>
      )}

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
            <option value="late">Gecikmiş görevi olanlar</option>
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
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Link
          href="/sales?status=late"
          className={`card card-pad block hover:ring-2 hover:ring-red-200 ${alarmCount ? "border-red-200 bg-red-50" : ""}`}
        >
          <div className="text-xs text-slate-500">Görev alarmı</div>
          <div className={`text-xl font-semibold tabular-nums ${alarmCount ? "text-red-600" : "text-emerald-700"}`}>
            {alarmCount ? `${alarmCount} satır` : "Yok"}
          </div>
          <div className="text-xs text-slate-500">{alarmCount ? "Gecikmiş/engellenmiş görev" : "Görevler zamanında"}</div>
        </Link>
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
          <table className="w-full min-w-[1750px] text-sm">
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
                <th className="th">Görevler</th>
                <th className="th"></th>
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
                const h = health.get(r.id);
                const rowBg = h?.row === "alarm" ? "bg-red-50" : h?.row === "ok" ? "bg-emerald-50" : band ? "bg-white" : "bg-slate-50/60";
                const accent = h?.row === "alarm" ? "border-l-4 border-l-red-500" : h?.row === "ok" ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-transparent";
                return (
                  <tr key={r.id} className={`border-b border-slate-100 ${rowBg} ${accent} ${r.status === "CANCELLED" ? "opacity-50" : ""}`}>
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
                      {r.productionOrder && h ? (
                        <Link href={`/orders/${r.productionOrder.id}`} className="group block" title="Görev detayına git">
                          <div className="flex items-center gap-1">
                            {h.steps.map((st) => (
                              <span
                                key={st.id}
                                className={`h-2.5 w-5 rounded-sm ${STEP_STYLE[st.state].dot}`}
                                title={`${st.name}: ${STEP_STYLE[st.state].label}${st.dueDate ? ` · bitiş ${formatDate(st.dueDate)}` : ""}`}
                              />
                            ))}
                            <span className="ml-1 text-xs tabular-nums text-slate-500">%{orderProgress(r.productionOrder.tasks)}</span>
                          </div>
                          <div className="mt-1"><Badge tone={h.tone}>{h.label}</Badge></div>
                        </Link>
                      ) : r.productionOrder ? (
                        <Link href={`/orders/${r.productionOrder.id}`} className="text-xs text-indigo-700 hover:underline">
                          {r.productionOrder.code} · görev yok
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="td text-right">
                      {(r.status === "RECEIVED" || r.status === "IN_PRODUCTION") && (
                        <QuickShip
                          lineId={r.id}
                          title={`${so.code} · ${r.model}${r.color ? ` / ${r.color}` : ""}`}
                          ordered={r.totals.qty}
                          shipped={r.totals.shippedQty}
                          today={todayStr}
                        />
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
