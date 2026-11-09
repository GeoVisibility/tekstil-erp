// Sipariş listesi için ortak etiketler ve hesaplamalar (sunucu + istemci).
import type { Currency, SalesLineStatus } from "@prisma/client";
import type { Tone } from "./labels";

export const SIZE_SLOTS = 10;
export const CURRENCIES: Currency[] = ["EUR", "USD", "GBP", "TRY"];

export const LINE_STATUS: Record<SalesLineStatus, { label: string; short: string; tone: Tone }> = {
  RECEIVED: { label: "Alındı", short: "A", tone: "blue" },
  IN_PRODUCTION: { label: "Üretimde", short: "Ü", tone: "amber" },
  SHIPPED: { label: "Yüklendi", short: "Y", tone: "green" },
  // Excel'e indirirken Mutlu Bey'in tablosundaki gibi küçük "i" yazılır
  CANCELLED: { label: "İptal", short: "i", tone: "red" },
};
export const LINE_STATUSES = Object.keys(LINE_STATUS) as SalesLineStatus[];

export function money(v: number | null | undefined, currency: Currency) {
  if (v == null || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
}

export function num(v: number | null | undefined, digits = 0) {
  if (v == null) return "—";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(v);
}

export const sumQty = (q: number[]) => q.reduce((a, b) => a + (b || 0), 0);

/** Beden setindeki dolu slotları {index, label} olarak döndürür. */
export function sizeSlots(sizes: string[] | undefined) {
  const s = sizes ?? [];
  return Array.from({ length: SIZE_SLOTS }, (_, i) => ({ index: i, label: s[i] ?? "" })).filter((x) => x.label);
}

/** "S:10 M:30" biçiminde kısa beden özeti */
export function sizeSummary(quantities: number[], sizes: string[] | undefined) {
  return quantities
    .map((q, i) => (q ? `${sizes?.[i] || `#${i + 1}`}:${q}` : null))
    .filter(Boolean)
    .join("  ");
}

export type LineTotals = { qty: number; amount: number | null; shippedQty: number; shippedAmount: number | null };

export function lineTotals(l: { quantities: number[]; unitPrice: number | null; shipments: { quantity: number }[]; status: SalesLineStatus }): LineTotals {
  const qty = l.status === "CANCELLED" ? 0 : sumQty(l.quantities);
  const shippedQty = l.shipments.reduce((a, s) => a + s.quantity, 0);
  return {
    qty,
    amount: l.unitPrice != null ? l.unitPrice * qty : null,
    shippedQty,
    shippedAmount: l.unitPrice != null ? l.unitPrice * shippedQty : null,
  };
}

/** Para birimi bazında toplayıcı */
export function addTo(map: Partial<Record<Currency, number>>, c: Currency, v: number | null | undefined) {
  if (v == null) return;
  map[c] = (map[c] ?? 0) + v;
}
