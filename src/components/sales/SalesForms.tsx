"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { Currency } from "@prisma/client";
import { createSalesOrder, saveSalesLines } from "@/app/(app)/sales/actions";
import { CURRENCIES } from "@/lib/sales";
import { useUnsavedWarning } from "@/lib/useUnsavedWarning";
import { LinesTable, emptyLine, toPayload, type LineDraft, type SizeSetOption } from "./LinesTable";

function Toast({ msg, onClose }: { msg: { type: "error" | "ok"; text: string } | null; onClose: (v: null) => void }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => onClose(null), msg.type === "ok" ? 3000 : 7000);
    return () => clearTimeout(t);
  }, [msg, onClose]);
  if (!msg) return null;
  return (
    <div
      role={msg.type === "error" ? "alert" : "status"}
      className={`fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg px-4 py-3 text-sm text-white shadow-lg ${
        msg.type === "error" ? "bg-red-600" : "bg-emerald-600"
      }`}
    >
      {msg.text}
    </div>
  );
}

type Option = { id: string; name: string };

/** Yeni sipariş: başlık + satırlar tek seferde kaydedilir. */
export function SalesOrderCreateForm({
  defaultCode,
  customers,
  companies,
  sizeSets,
  today,
}: {
  defaultCode: string;
  customers: (Option & { companyId: string | null })[];
  companies: Option[] | null; // yalnızca developer için
  sizeSets: SizeSetOption[];
  today: string;
}) {
  const [header, setHeader] = useState({
    code: defaultCode,
    companyId: companies?.[0]?.id ?? "",
    customerId: "",
    customerOrderNo: "",
    orderDate: today,
    currency: "EUR" as Currency,
    notes: "",
  });
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine(sizeSets[0]?.id ?? "")]);
  const [msg, setMsg] = useState<{ type: "error" | "ok"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  const dirty = !saved && (lines.some((l) => l.model || l.quantities.some(Boolean)) || !!header.customerId);
  useUnsavedWarning(dirty);

  const visibleCustomers = companies ? customers.filter((c) => c.companyId === header.companyId) : customers;
  const set = (patch: Partial<typeof header>) => setHeader((h) => ({ ...h, ...patch }));

  function submit() {
    start(async () => {
      setSaved(true); // başarılı olursa sayfa yönlenir; uyarı çıkmasın
      const res = await createSalesOrder(header, lines.map(toPayload));
      if (res?.error) {
        setSaved(false);
        setMsg({ type: "error", text: res.error });
      }
    });
  }

  return (
    <div className="space-y-6">
      <section className="card card-pad">
        <h2 className="mb-4 font-semibold">Sipariş bilgileri</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label">Sipariş kodu *</label>
            <input value={header.code} onChange={(e) => set({ code: e.target.value })} className="input" />
          </div>
          {companies && (
            <div>
              <label className="label">Firma *</label>
              <select value={header.companyId} onChange={(e) => set({ companyId: e.target.value, customerId: "" })} className="input">
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">Müşteri *</label>
            <select value={header.customerId} onChange={(e) => set({ customerId: e.target.value })} className="input">
              <option value="">— Seçiniz —</option>
              {visibleCustomers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Müşteri sipariş no</label>
            <input value={header.customerOrderNo} onChange={(e) => set({ customerOrderNo: e.target.value })} className="input" placeholder="örn. MIK001" />
          </div>
          <div>
            <label className="label">Sipariş tarihi *</label>
            <input type="date" value={header.orderDate} onChange={(e) => set({ orderDate: e.target.value })} className="input" />
          </div>
          <div>
            <label className="label">Döviz</label>
            <select value={header.currency} onChange={(e) => set({ currency: e.target.value as Currency })} className="input">
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Not</label>
            <input value={header.notes} onChange={(e) => set({ notes: e.target.value })} className="input" />
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-pad pb-3">
          <h2 className="font-semibold">Satırlar</h2>
          <p className="text-sm text-slate-500">Her satır bir model + renk. Aynı modelin başka rengi için ⧉ ile satırı kopyalayın.</p>
        </div>
        <LinesTable lines={lines} onChange={setLines} sizeSets={sizeSets} currency={header.currency} />
      </section>

      <div className="flex justify-end">
        <button type="button" className="btn-primary" disabled={pending} onClick={submit}>
          {pending ? "Kaydediliyor…" : "Siparişi oluştur"}
        </button>
      </div>
      <Toast msg={msg} onClose={setMsg} />
    </div>
  );
}

/** Sipariş detayındaki satırlar: değişiklikler biriktirilir, tek butonla kaydedilir. */
export function SalesLinesSection({
  orderId,
  lines: savedLines,
  sizeSets,
  currency,
}: {
  orderId: string;
  lines: LineDraft[];
  sizeSets: SizeSetOption[];
  currency: Currency;
}) {
  const savedKey = JSON.stringify(savedLines);
  const initial = useMemo(() => JSON.parse(savedKey) as LineDraft[], [savedKey]);
  const initialMap = useMemo(() => Object.fromEntries(initial.map((l) => [l.key, l])), [initial]);
  const [lines, setLines] = useState<LineDraft[]>(initial);
  const [msg, setMsg] = useState<{ type: "error" | "ok"; text: string } | null>(null);
  const [pending, start] = useTransition();

  // Kayıttan sonra (sunucu verisi değişince) taslağı yenile
  useEffect(() => setLines(initial), [initial]);

  const dirty = JSON.stringify(lines.map(toPayload)) !== JSON.stringify(initial.map(toPayload));
  useUnsavedWarning(dirty);

  function save() {
    start(async () => {
      const res = await saveSalesLines(orderId, lines.map(toPayload));
      setMsg(res.error ? { type: "error", text: res.error } : { type: "ok", text: "Satırlar kaydedildi." });
    });
  }

  return (
    <section className="card mb-6">
      <div className="card-pad flex flex-wrap items-end justify-between gap-3 pb-3">
        <div>
          <h2 className="font-semibold">Satırlar</h2>
          <p className="text-sm text-slate-500">Değişiklikler sarıyla gösterilir; kaydetmeden sayfadan çıkarken uyarılırsınız.</p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-sm text-amber-700">Kaydedilmemiş değişiklik var</span>}
          <button type="button" className="btn" disabled={!dirty || pending} onClick={() => setLines(initial)}>Vazgeç</button>
          <button type="button" className="btn-primary" disabled={!dirty || pending} onClick={save}>
            {pending ? "Kaydediliyor…" : "Değişiklikleri kaydet"}
          </button>
        </div>
      </div>
      <LinesTable lines={lines} onChange={setLines} sizeSets={sizeSets} currency={currency} initial={initialMap} />
      {dirty && (
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 rounded-b-xl border-t border-amber-200 bg-amber-50 px-5 py-3">
          <span className="text-sm text-amber-800">Satırlarda kaydedilmemiş değişiklik var.</span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-xs" disabled={pending} onClick={() => setLines(initial)}>Vazgeç</button>
            <button type="button" className="btn-primary btn-xs" disabled={pending} onClick={save}>
              {pending ? "Kaydediliyor…" : "Tümünü kaydet"}
            </button>
          </div>
        </div>
      )}
      <Toast msg={msg} onClose={setMsg} />
    </section>
  );
}
