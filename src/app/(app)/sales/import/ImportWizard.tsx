"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import type { SalesLineStatus } from "@prisma/client";
import { LINE_STATUS, LINE_STATUSES, money, num, sumQty } from "@/lib/sales";
import { commitImport, previewImport, type CommitResult, type ImportPreview } from "./actions";

export function ImportWizard({ companies }: { companies: { id: string; name: string }[] | null }) {
  const [preview, formAction, reading] = useActionState<ImportPreview, FormData>(previewImport, {});
  const [statusMap, setStatusMap] = useState<Record<string, SalesLineStatus>>({});
  const [clientMap, setClientMap] = useState<Record<string, string>>({});
  const [importPayments, setImportPayments] = useState(true);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [saving, start] = useTransition();

  // Yeni önizleme gelince önerilen eşleştirmeleri yükle
  useEffect(() => {
    setResult(null);
    setStatusMap(Object.fromEntries((preview.statusCodes ?? []).map((s) => [s.code, s.suggested])));
    setClientMap(Object.fromEntries((preview.clients ?? []).map((c) => [c.name, c.matchId ?? "new"])));
  }, [preview]);

  const rows = useMemo(() => preview.rows ?? [], [preview.rows]);
  const existing = new Set(preview.existingCodes ?? []);
  const importable = rows.filter((r) => !existing.has(r.code));
  const orderCount = new Set(importable.map((r) => r.code)).size;
  const receivedTotal = importable.reduce((a, r) => a + (r.received ?? 0), 0);
  const newClientCount = Object.values(clientMap).filter((v) => v === "new").length;

  function commit() {
    start(async () => {
      const res = await commitImport({ companyId: preview.companyId!, rows, statusMap, clientMap, importPayments });
      setResult(res);
    });
  }

  if (result && !result.error) {
    return (
      <div className="card card-pad max-w-xl space-y-3">
        <h2 className="text-lg font-semibold text-emerald-700">Aktarım tamamlandı</h2>
        <ul className="list-disc pl-5 text-sm">
          <li>{result.created} sipariş, {result.lines} satır oluşturuldu.</li>
          {!!result.newCustomers && <li>{result.newCustomers} yeni müşteri eklendi.</li>}
          {!!result.payments && <li>{result.payments} siparişe tahsilat (ALINAN BEDEL) girildi.</li>}
          {!!result.tasksOpened && <li>{result.tasksOpened} açık satıra görevler (kumaş → kutu/paket) otomatik açıldı.</li>}
          {!!result.skipped?.length && <li>Zaten kayıtlı olduğu için atlanan sipariş kodları: {result.skipped.join(", ")}</li>}
        </ul>
        <Link href="/sales" className="btn-primary">Sipariş listesine git</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form action={formAction} className="card card-pad grid gap-3 sm:grid-cols-[1fr_auto] lg:grid-cols-[2fr_1fr_auto]">
        <div>
          <label className="label">Excel dosyası (.xlsx)</label>
          <input type="file" name="file" accept=".xlsx" className="input" required />
          <p className="mt-1 text-xs text-slate-500">
            &quot;Genel Sipariş&quot; düzenindeki tablo: S, OR.DATE, SİP KOD., CLIENT, ORDER, MODEL, COLOUR, FABRIC, GRADE, beden sütunları,
            TOPLAM, DATE, PRICE, YÜKLENEN, DÖVİZ… Önce önizleme gösterilir, onaylamadan hiçbir şey kaydedilmez.
          </p>
        </div>
        {companies && (
          <div>
            <label className="label">Firma</label>
            <select name="companyId" className="input">
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex items-end">
          <button className="btn-primary" disabled={reading}>{reading ? "Okunuyor…" : "Önizle"}</button>
        </div>
      </form>

      {preview.error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{preview.error}</div>}
      {result?.error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{result.error}</div>}

      {rows.length > 0 && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card card-pad">
              <h2 className="mb-1 font-semibold">Durum kodları</h2>
              <p className="mb-3 text-sm text-slate-500">Excel&apos;deki S sütunundaki her kodun programdaki karşılığını seçin.</p>
              <div className="space-y-2">
                {preview.statusCodes!.map((s) => (
                  <div key={s.code} className="flex items-center gap-3">
                    <span className="w-16 rounded bg-slate-100 px-2 py-1 text-center font-mono text-sm">{s.code || "(boş)"}</span>
                    <span className="w-20 text-xs text-slate-500">{s.count} satır</span>
                    <select
                      value={statusMap[s.code] ?? s.suggested}
                      onChange={(e) => setStatusMap({ ...statusMap, [s.code]: e.target.value as SalesLineStatus })}
                      className="input-sm"
                    >
                      {LINE_STATUSES.map((st) => (
                        <option key={st} value={st}>{LINE_STATUS[st].label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </section>

            <section className="card card-pad">
              <h2 className="mb-1 font-semibold">Müşteriler</h2>
              <p className="mb-3 text-sm text-slate-500">
                Aynı isimli müşteriler otomatik eşleşti. Eşleşmeyenler yeni müşteri olarak eklenir; isterseniz mevcut bir müşteriyle eşleştirin.
              </p>
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {preview.clients!.map((c) => (
                  <div key={c.name} className="flex items-center gap-3">
                    <span className="w-44 truncate text-sm font-medium" title={c.name}>{c.name}</span>
                    <span className="w-16 text-xs text-slate-500">{c.count} satır</span>
                    <select
                      value={clientMap[c.name] ?? "new"}
                      onChange={(e) => setClientMap({ ...clientMap, [c.name]: e.target.value })}
                      className={`input-sm flex-1 ${clientMap[c.name] === "new" ? "!border-amber-400" : ""}`}
                    >
                      <option value="new">+ Yeni müşteri olarak ekle</option>
                      {preview.customers!.map((x) => (
                        <option key={x.id} value={x.id}>{x.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {preview.warnings!.length > 0 && (
            <details className="card card-pad">
              <summary className="cursor-pointer text-sm font-medium text-amber-700">{preview.warnings!.length} uyarı</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
                {preview.warnings!.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}

          <section className="card overflow-x-auto">
            <div className="card-pad pb-3">
              <h2 className="font-semibold">Önizleme — &quot;{preview.sheetName}&quot; sayfası, {rows.length} satır</h2>
              {existing.size > 0 && (
                <p className="text-sm text-amber-700">
                  Zaten kayıtlı sipariş kodları atlanacak: {[...existing].join(", ")}
                </p>
              )}
            </div>
            <table className="w-full min-w-[1200px] text-xs">
              <thead className="border-y border-slate-200 bg-slate-50">
                <tr>
                  {["Satır", "S", "Tarih", "Kod", "Müşteri", "Sip. no", "Model", "Renk", "Set", "Adet", "Termin", "Fiyat", "Yüklenen", "Alınan bedel"].map((h) => (
                    <th key={h} className="th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.rowNo} className={existing.has(r.code) ? "opacity-40 line-through" : ""}>
                    <td className="td text-slate-400">{r.rowNo}</td>
                    <td className="td font-mono">{r.statusCode}</td>
                    <td className="td whitespace-nowrap">{r.orderDate || "—"}</td>
                    <td className="td">{r.code}</td>
                    <td className="td">{r.client}</td>
                    <td className="td">{r.customerOrderNo}</td>
                    <td className="td font-medium">{r.model}</td>
                    <td className="td">{r.color}</td>
                    <td className="td">{r.grade}</td>
                    <td className="td text-right tabular-nums">{num(sumQty(r.quantities))}</td>
                    <td className="td whitespace-nowrap">{r.deliveryDate || "—"}</td>
                    <td className="td text-right tabular-nums">{r.unitPrice != null ? money(r.unitPrice, r.currency) : "—"}</td>
                    <td className="td text-right tabular-nums">{r.shipped ? num(r.shipped) : "—"}</td>
                    <td className="td text-right tabular-nums">{r.received != null ? money(r.received, r.currency) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card card-pad flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-2 text-sm">
              <div>
                <b>{orderCount}</b> sipariş, <b>{importable.length}</b> satır aktarılacak
                {newClientCount > 0 && <> · <b>{newClientCount}</b> yeni müşteri eklenecek</>}.
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={importPayments} onChange={(e) => setImportPayments(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
                &quot;ALINAN BEDEL&quot; sütununu tahsilat olarak aktar
                <span className="text-xs text-slate-500">(toplam {num(receivedTotal, 2)} — Excel&apos;de çoğu satırda tutarın yarısı formülle yazılmış)</span>
              </label>
            </div>
            <button type="button" className="btn-primary" disabled={saving || importable.length === 0} onClick={commit}>
              {saving ? "Aktarılıyor…" : `${orderCount} siparişi içe aktar`}
            </button>
          </section>
        </>
      )}
    </div>
  );
}
