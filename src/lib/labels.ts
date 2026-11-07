import type { ComponentCategory, OrderStatus, SupplyStatus, TaskStatus, OrgType } from "@prisma/client";

export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Taslak", tone: "gray" },
  PLANNING: { label: "Planlama", tone: "blue" },
  IN_PRODUCTION: { label: "Üretimde", tone: "amber" },
  COMPLETED: { label: "Tamamlandı", tone: "green" },
  CANCELLED: { label: "İptal", tone: "red" },
};

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Bekliyor", tone: "gray" },
  IN_PROGRESS: { label: "Devam ediyor", tone: "amber" },
  DONE: { label: "Tamamlandı", tone: "green" },
  BLOCKED: { label: "Engellendi", tone: "red" },
};

export const SUPPLY_STATUS: Record<SupplyStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Tedarik bekliyor", tone: "gray" },
  ORDERED: { label: "Sipariş verildi", tone: "blue" },
  IN_STOCK: { label: "Depoda", tone: "green" },
};

export const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  FABRIC: "Kumaş",
  TRIM: "Aksesuar",
  PRINT: "Baskı",
  EMBROIDERY: "Nakış",
  LABEL: "Etiket",
  PACKAGING: "Ambalaj",
};

export const ORG_TYPE_LABELS: Record<OrgType, string> = {
  COMPANY: "Firma",
  SUBCOMPANY: "Alt Firma",
  CUSTOMER: "Müşteri",
};

export type Tone = "gray" | "blue" | "amber" | "green" | "red";

export function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
}

export function toInputDate(d: Date | null | undefined) {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}
