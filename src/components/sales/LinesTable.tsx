"use client";

import type { Currency, SalesLineStatus } from "@prisma/client";
import { LINE_STATUS, LINE_STATUSES, SIZE_SLOTS, money, num } from "@/lib/sales";

export type SizeSetOption = { id: string; code: string; name: string | null; sizes: string[] };

/** Formdaki bir satırın taslağı (inputlar string tutar). */
export type LineDraft = {
  key: string;
  id?: string;
  model: string;
  color: string;
  fabric: string;
  sizeSetId: string;
  quantities: string[];
  deliveryDate: string;
  unitPrice: string;
  status: SalesLineStatus;
  notes: string;
  /** Kayıtlı satırın sevkiyatı / üretim bağlantısı varsa silinemez */
  locked?: boolean;
};

let seq = 0;
export const newKey = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`;

export function emptyLine(sizeSetId = ""): LineDraft {
  return {
    key: newKey(),
    model: "",
    color: "",
    fabric: "",
    sizeSetId,
    quantities: Array(SIZE_SLOTS).fill(""),
    deliveryDate: "",
    unitPrice: "",
    status: "RECEIVED",
    notes: "",
  };
}

export const toNumber = (v: string) => {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
};
const qtyOf = (l: LineDraft) => l.quantities.reduce((a, q) => a + (parseInt(q, 10) || 0), 0);

/** Sunucuya gönderilecek biçim */
export function toPayload(l: LineDraft) {
  return {
    id: l.id,
    model: l.model,
    color: l.color,
    fabric: l.fabric,
    sizeSetId: l.sizeSetId,
    quantities: l.quantities.map((q) => parseInt(q, 10) || 0),
    deliveryDate: l.deliveryDate,
    unitPrice: l.unitPrice,
    status: l.status,
    notes: l.notes,
  };
}

/** Excel benzeri satır tablosu (kontrollü bileşen). */
export function LinesTable({
  lines,
  onChange,
  sizeSets,
  currency,
  initial,
}: {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  sizeSets: SizeSetOption[];
  currency: Currency;
  /** Kayıtlı değerler (değişen hücreleri vurgulamak için) */
  initial?: Record<string, LineDraft>;
}) {
  const setsById = Object.fromEntries(sizeSets.map((s) => [s.id, s]));
  const update = (key: string, patch: Partial<LineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const changed = (l: LineDraft, f: keyof LineDraft) => {
    const o = initial?.[l.key];
    if (!initial) return false;
    if (!o) return true; // yeni satır
    return JSON.stringify(o[f]) !== JSON.stringify(l[f]);
  };
  const cell = (l: LineDraft, f: keyof LineDraft, extra = "") => `input-sm w-full ${extra} ${changed(l, f) ? "!border-amber-400 bg-amber-50" : ""}`;

  const totalQty = lines.reduce((a, l) => a + (l.status === "CANCELLED" ? 0 : qtyOf(l)), 0);
  const totalAmount = lines.reduce((a, l) => a + (l.status === "CANCELLED" ? 0 : qtyOf(l) * (toNumber(l.unitPrice) ?? 0)), 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1500px] text-sm">
        <thead className="border-y border-slate-200 bg-slate-50">
          <tr>
            <th className="th w-8">#</th>
            <th className="th w-48">Model *</th>
            <th className="th w-32">Renk</th>
            <th className="th w-56">Kumaş</th>
            <th className="th w-20">Set</th>
            <th className="th">Bedenler (adet)</th>
            <th className="th w-20 text-right">Toplam</th>
            <th className="th w-36">Termin</th>
            <th className="th w-24">Fiyat</th>
            <th className="th w-28 text-right">Tutar</th>
            <th className="th w-32">Durum</th>
            <th className="th w-20"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((l, idx) => {
            const set = setsById[l.sizeSetId];
            const qty = qtyOf(l);
            const price = toNumber(l.unitPrice);
            const isNew = initial && !initial[l.key];
            return (
              <tr key={l.key} className={`${isNew ? "bg-emerald-50/40" : ""} ${l.status === "CANCELLED" ? "opacity-50" : ""}`}>
                <td className="td text-xs text-slate-400">{idx + 1}</td>
                <td className="td">
                  <input value={l.model} onChange={(e) => update(l.key, { model: e.target.value })} className={cell(l, "model")} placeholder="örn. HOODIE" />
                </td>
                <td className="td">
                  <input value={l.color} onChange={(e) => update(l.key, { color: e.target.value })} className={cell(l, "color")} />
                </td>
                <td className="td">
                  <input value={l.fabric} onChange={(e) => update(l.key, { fabric: e.target.value })} className={cell(l, "fabric")} />
                </td>
                <td className="td">
                  <select value={l.sizeSetId} onChange={(e) => update(l.key, { sizeSetId: e.target.value })} className={cell(l, "sizeSetId")} title={set?.name ?? ""}>
                    <option value="">—</option>
                    {sizeSets.map((s) => (
                      <option key={s.id} value={s.id} title={s.name ?? ""}>{s.code}</option>
                    ))}
                  </select>
                </td>
                <td className="td">
                  <div className="flex gap-1">
                    {Array.from({ length: SIZE_SLOTS }, (_, i) => {
                      const label = set ? set.sizes[i] : String(i + 1);
                      if (set && !label) return null;
                      return (
                        <label key={i} className="flex w-12 flex-col items-center">
                          <span className="text-[10px] font-medium text-slate-500">{label}</span>
                          <input
                            inputMode="numeric"
                            value={l.quantities[i] ?? ""}
                            onChange={(e) => {
                              const q = [...l.quantities];
                              q[i] = e.target.value.replace(/[^\d]/g, "");
                              update(l.key, { quantities: q });
                            }}
                            className={`input-sm w-full px-1 text-center ${changed(l, "quantities") ? "!border-amber-400 bg-amber-50" : ""}`}
                          />
                        </label>
                      );
                    })}
                  </div>
                </td>
                <td className="td text-right font-medium tabular-nums">{num(qty)}</td>
                <td className="td">
                  <input type="date" value={l.deliveryDate} onChange={(e) => update(l.key, { deliveryDate: e.target.value })} className={cell(l, "deliveryDate")} />
                </td>
                <td className="td">
                  <input inputMode="decimal" value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} className={cell(l, "unitPrice", "text-right")} />
                </td>
                <td className="td text-right tabular-nums">{price != null ? money(price * qty, currency) : "—"}</td>
                <td className="td">
                  <select value={l.status} onChange={(e) => update(l.key, { status: e.target.value as SalesLineStatus })} className={cell(l, "status")}>
                    {LINE_STATUSES.map((s) => (
                      <option key={s} value={s}>{LINE_STATUS[s].label}</option>
                    ))}
                  </select>
                </td>
                <td className="td">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      title="Satırı kopyala (örn. aynı model, farklı renk)"
                      className="btn btn-xs"
                      onClick={() => {
                        const copy: LineDraft = { ...l, key: newKey(), id: undefined, locked: false, color: "", status: "RECEIVED" };
                        const next = [...lines];
                        next.splice(idx + 1, 0, copy);
                        onChange(next);
                      }}
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      title={l.locked ? "Sevkiyatı veya üretim takibi olan satır silinemez" : "Satırı sil"}
                      disabled={l.locked}
                      className="btn btn-xs text-red-600"
                      onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-medium">
          <tr>
            <td className="td" colSpan={6}>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => onChange([...lines, emptyLine(lines[lines.length - 1]?.sizeSetId ?? sizeSets[0]?.id ?? "")])}
              >
                + Satır ekle
              </button>
            </td>
            <td className="td text-right tabular-nums">{num(totalQty)}</td>
            <td className="td" colSpan={2}></td>
            <td className="td text-right tabular-nums">{money(totalAmount, currency)}</td>
            <td className="td" colSpan={2}></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
