"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { SupplyStatus } from "@prisma/client";
import { saveComponents, type ComponentRowInput } from "@/app/(app)/orders/actions";
import { SUPPLY_STATUS, type Tone } from "@/lib/labels";
import { useUnsavedWarning } from "@/lib/useUnsavedWarning";
import { Badge } from "./ui";

export type ComponentRow = {
  id: string;
  name: string;
  categoryLabel: string;
  spec: string | null;
  color: string | null;
  quantityText: string;
  stage: { label: string; tone: Tone };
  supplyStatus: SupplyStatus;
  supplier: string;
  orderedAt: string; // YYYY-MM-DD veya ""
  expectedAt: string;
  receivedAt: string;
};

type Draft = Pick<ComponentRow, "supplyStatus" | "supplier" | "orderedAt" | "expectedAt" | "receivedAt">;
const FIELDS: (keyof Draft)[] = ["supplyStatus", "supplier", "orderedAt", "expectedAt", "receivedAt"];

const pick = (r: ComponentRow): Draft => ({
  supplyStatus: r.supplyStatus,
  supplier: r.supplier,
  orderedAt: r.orderedAt,
  expectedAt: r.expectedAt,
  receivedAt: r.receivedAt,
});

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmt(v: string) {
  if (!v) return "—";
  const [y, m, d] = v.split("-");
  return `${d}.${m}.${y}`;
}

/** Parça tablosu: değişiklikler biriktirilir ve tek butonla kaydedilir. */
export function ComponentsEditor({ orderId, rows, editable }: { orderId: string; rows: ComponentRow[]; editable: boolean }) {
  // Sunucudaki kayıtlı değerler. İçerik değişmedikçe (örn. görev butonları sayfayı yenilediğinde) aynı kalır.
  const initialKey = JSON.stringify(rows.map((r) => [r.id, pick(r)]));
  const initial = useMemo(
    () => Object.fromEntries((JSON.parse(initialKey) as [string, Draft][])) as Record<string, Draft>,
    [initialKey],
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>(initial);

  // Kayıt sonrası (veya veri sunucuda değiştiğinde) taslakları kayıtlı değerlere eşitle
  useEffect(() => setDrafts(initial), [initial]);
  const [message, setMessage] = useState<{ type: "error" | "ok"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const changedIds = rows.filter((r) => FIELDS.some((f) => drafts[r.id][f] !== initial[r.id][f])).map((r) => r.id);
  const dirty = changedIds.length > 0;

  useUnsavedWarning(dirty);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), message.type === "ok" ? 3000 : 6000);
    return () => clearTimeout(t);
  }, [message]);

  function update(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => {
      const next = { ...prev[id], ...patch };
      // Durum değişince ilgili tarih boşsa bugünle doldur
      if (patch.supplyStatus === "ORDERED" && !next.orderedAt) next.orderedAt = today();
      if (patch.supplyStatus === "IN_STOCK" && !next.receivedAt) next.receivedAt = today();
      return { ...prev, [id]: next };
    });
  }

  function save() {
    const payload: ComponentRowInput[] = changedIds.map((id) => ({ id, ...drafts[id] }));
    startTransition(async () => {
      const res = await saveComponents(orderId, payload);
      if (res.error) setMessage({ type: "error", text: res.error });
      else setMessage({ type: "ok", text: `${payload.length} parça kaydedildi.` });
      // Başarılıysa sayfa yeni verilerle yenilenir ve bileşen temiz durumda yeniden oluşur.
    });
  }

  const now = today();

  return (
    <section className="card mb-6">
      <div className="card-pad flex flex-wrap items-end justify-between gap-3 pb-3">
        <div>
          <h2 className="font-semibold">Parçalar ve malzemeler</h2>
          <p className="text-sm text-slate-500">Her parçanın tedarik durumu, tarihleri ve şu an hangi işlemde olduğu</p>
        </div>
        {editable && (
          <div className="flex items-center gap-2">
            {dirty && <span className="text-sm text-amber-700">{changedIds.length} parçada değişiklik</span>}
            <button type="button" className="btn" disabled={!dirty || pending} onClick={() => setDrafts(initial)}>
              Vazgeç
            </button>
            <button type="button" className="btn-primary" disabled={!dirty || pending} onClick={save}>
              {pending ? "Kaydediliyor…" : "Değişiklikleri kaydet"}
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px]">
          <thead className="border-y border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Parça</th>
              <th className="th">Detay</th>
              <th className="th">Bulunduğu işlem</th>
              <th className="th w-40">Tedarik durumu</th>
              <th className="th w-40">Tedarikçi</th>
              <th className="th w-36">Sipariş verildi</th>
              <th className="th w-36">Beklenen geliş</th>
              <th className="th w-36">Depoya giriş</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const d = drafts[r.id];
              const changed = changedIds.includes(r.id);
              const late = d.supplyStatus !== "IN_STOCK" && d.expectedAt !== "" && d.expectedAt < now;
              const cls = (f: keyof Draft) => `input-sm w-full ${d[f] !== initial[r.id][f] ? "!border-amber-400 bg-amber-50" : ""}`;
              return (
                <tr key={r.id} className={changed ? "bg-amber-50/40" : ""}>
                  <td className="td">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-slate-500">{r.categoryLabel}</div>
                  </td>
                  <td className="td text-slate-600">
                    <div className="max-w-xs">{r.spec ?? "—"}</div>
                    <div className="text-xs text-slate-500">
                      {[r.color && `Renk: ${r.color}`, r.quantityText].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="td">
                    <Badge tone={r.stage.tone}>{r.stage.label}</Badge>
                  </td>
                  {editable ? (
                    <>
                      <td className="td">
                        <select
                          value={d.supplyStatus}
                          onChange={(e) => update(r.id, { supplyStatus: e.target.value as SupplyStatus })}
                          className={cls("supplyStatus")}
                        >
                          {Object.entries(SUPPLY_STATUS).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="td">
                        <input
                          value={d.supplier}
                          onChange={(e) => update(r.id, { supplier: e.target.value })}
                          placeholder="Tedarikçi"
                          className={cls("supplier")}
                        />
                      </td>
                      <td className="td">
                        <input type="date" value={d.orderedAt} onChange={(e) => update(r.id, { orderedAt: e.target.value })} className={cls("orderedAt")} />
                      </td>
                      <td className="td">
                        <input
                          type="date"
                          value={d.expectedAt}
                          onChange={(e) => update(r.id, { expectedAt: e.target.value })}
                          className={`${cls("expectedAt")} ${late ? "!border-red-400 text-red-700" : ""}`}
                        />
                        {late && <div className="mt-0.5 text-[11px] font-medium text-red-600">Gecikti</div>}
                      </td>
                      <td className="td">
                        <input type="date" value={d.receivedAt} onChange={(e) => update(r.id, { receivedAt: e.target.value })} className={cls("receivedAt")} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="td">
                        <Badge tone={SUPPLY_STATUS[d.supplyStatus].tone}>{SUPPLY_STATUS[d.supplyStatus].label}</Badge>
                      </td>
                      <td className="td text-sm">{d.supplier || "—"}</td>
                      <td className="td whitespace-nowrap text-sm">{fmt(d.orderedAt)}</td>
                      <td className={`td whitespace-nowrap text-sm ${late ? "font-medium text-red-600" : ""}`}>
                        {fmt(d.expectedAt)}
                        {late && <div className="text-[11px]">Gecikti</div>}
                      </td>
                      <td className="td whitespace-nowrap text-sm">{fmt(d.receivedAt)}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Değişiklik varken tablo kaydırılsa da görünen kaydet çubuğu */}
      {editable && dirty && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-b-xl border-t border-amber-200 bg-amber-50 px-5 py-3">
          <span className="text-sm text-amber-800">
            <b>{changedIds.length}</b> parçada kaydedilmemiş değişiklik var.
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-xs" disabled={pending} onClick={() => setDrafts(initial)}>Vazgeç</button>
            <button type="button" className="btn-primary btn-xs" disabled={pending} onClick={save}>
              {pending ? "Kaydediliyor…" : "Tümünü kaydet"}
            </button>
          </div>
        </div>
      )}

      {message && (
        <div
          role={message.type === "error" ? "alert" : "status"}
          className={`fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-lg px-4 py-3 text-sm text-white shadow-lg ${
            message.type === "error" ? "bg-red-600" : "bg-emerald-600"
          }`}
        >
          {message.text}
        </div>
      )}
    </section>
  );
}
