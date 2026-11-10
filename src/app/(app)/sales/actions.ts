"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Currency, SalesLineStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withFormState, type FormState } from "@/lib/form";
import type { SessionPayload } from "@/lib/jwt";
import { parseDateInput } from "@/lib/labels";
import { SIZE_SLOTS, sumQty } from "@/lib/sales";
import {
  createTasksForLinkedLine,
  LINES_WITHOUT_TASKS,
  openProductionForLine,
  openProductionForLines,
  rescheduleLine,
  startedProductionIds,
} from "@/lib/salesProduction";
import { salesScope } from "@/lib/scope";
import { requireRole } from "@/lib/session";

// ─── Ortak doğrulama ───────────────────────────────────────────

const dateStr = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Geçersiz tarih.")
  .transform((v) => (v ? parseDateInput(v) : null));

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

const decimal = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      ctx.addIssue({ code: "custom", message: "Fiyat/tutar sayı olmalı." });
      return z.NEVER;
    }
    return n;
  });

const lineSchema = z.object({
  id: z.string().optional(),
  model: z.string().trim().min(1, "Her satırda model adı olmalı.").max(200),
  color: optText(100),
  fabric: optText(300),
  sizeSetId: z.string().optional().transform((v) => v || null),
  quantities: z
    .array(z.coerce.number().int("Adetler tam sayı olmalı.").min(0, "Adet negatif olamaz."))
    .max(SIZE_SLOTS)
    .transform((q) => Array.from({ length: SIZE_SLOTS }, (_, i) => q[i] ?? 0)),
  deliveryDate: dateStr,
  unitPrice: decimal,
  status: z.enum(SalesLineStatus).default("RECEIVED"),
  notes: optText(500),
});
export type SalesLineInput = z.input<typeof lineSchema>;

const headerSchema = z.object({
  code: z.string().trim().min(1, "Sipariş kodu gerekli.").max(40),
  customerId: z.string().min(1, "Müşteri seçilmeli."),
  companyId: z.string().optional(),
  customerOrderNo: optText(60),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sipariş tarihi gerekli.").transform(parseDateInput),
  currency: z.enum(Currency),
  notes: optText(2000),
});
export type SalesHeaderInput = z.input<typeof headerSchema>;

async function resolveCompanyAndCustomer(s: SessionPayload, companyIdInput: string | undefined, customerId: string) {
  const companyId = s.role === "COMPANY" ? s.orgId : companyIdInput;
  if (!companyId) throw new Error("Firma seçilmeli.");
  const customer = await prisma.organization.findFirst({ where: { id: customerId, parentId: companyId, type: "CUSTOMER" } });
  if (!customer) throw new Error("Müşteri bu firmaya bağlı değil.");
  return { companyId, customerId: customer.id };
}

async function manageableSales(s: SessionPayload, id: string) {
  const order = await prisma.salesOrder.findFirst({ where: { AND: [{ id }, salesScope(s)] } });
  if (!order) throw new Error("Sipariş bulunamadı veya erişim yok.");
  return order;
}

function lineData(l: z.output<typeof lineSchema>, sortOrder: number) {
  return {
    model: l.model,
    color: l.color,
    fabric: l.fabric,
    sizeSetId: l.sizeSetId,
    quantities: l.quantities,
    deliveryDate: l.deliveryDate,
    unitPrice: l.unitPrice,
    status: l.status,
    notes: l.notes,
    sortOrder,
  };
}

const auth = () => requireRole("DEVELOPER", "COMPANY");

// ─── Sipariş oluşturma / güncelleme / silme ────────────────────

export async function createSalesOrder(header: SalesHeaderInput, lines: SalesLineInput[]): Promise<FormState> {
  let id = "";
  const res = await withFormState(async () => {
    const s = await auth();
    const h = headerSchema.parse(header);
    const ls = z.array(lineSchema).min(1, "En az bir satır girin.").max(300).parse(lines);
    const { companyId, customerId } = await resolveCompanyAndCustomer(s, h.companyId, h.customerId);
    if (await prisma.salesOrder.findUnique({ where: { companyId_code: { companyId, code: h.code } } })) {
      throw new Error(`"${h.code}" sipariş kodu zaten kullanılıyor.`);
    }
    const order = await prisma.salesOrder.create({
      data: {
        code: h.code,
        companyId,
        customerId,
        customerOrderNo: h.customerOrderNo,
        orderDate: h.orderDate,
        currency: h.currency,
        notes: h.notes,
        createdById: s.uid,
        lines: { create: ls.map((l, i) => lineData(l, i)) },
      },
      include: { lines: { select: { id: true }, orderBy: { sortOrder: "asc" } } },
    });
    id = order.id;
    // Her satır için görevler otomatik açılır
    await openProductionForLines(order.lines.map((l) => l.id), s.uid);
    revalidatePath("/orders");
    revalidatePath("/tasks");
    revalidatePath("/sales");
  });
  if (res.error) return res;
  redirect(`/sales/${id}`);
}

async function updateHeaderImpl(fd: FormData) {
  const s = await auth();
  const order = await manageableSales(s, String(fd.get("id")));
  const h = headerSchema.parse({ ...Object.fromEntries(fd), companyId: order.companyId });
  const { customerId } = await resolveCompanyAndCustomer(s, order.companyId, h.customerId);
  if (h.code !== order.code) {
    const dup = await prisma.salesOrder.findUnique({ where: { companyId_code: { companyId: order.companyId, code: h.code } } });
    if (dup) throw new Error(`"${h.code}" sipariş kodu zaten kullanılıyor.`);
  }
  await prisma.salesOrder.update({
    where: { id: order.id },
    data: {
      code: h.code,
      customerId,
      customerOrderNo: h.customerOrderNo,
      orderDate: h.orderDate,
      currency: h.currency,
      notes: h.notes,
    },
  });
  revalidatePath(`/sales/${order.id}`);
  revalidatePath("/sales");
}
export async function updateSalesHeader(_: FormState, fd: FormData) {
  return withFormState(() => updateHeaderImpl(fd));
}

/** Satırları toplu kaydeder: var olanları günceller, yenileri ekler, listeden çıkarılanları siler. */
export async function saveSalesLines(orderId: string, lines: SalesLineInput[]): Promise<FormState> {
  return withFormState(async () => {
    const s = await auth();
    const order = await manageableSales(s, orderId);
    const ls = z.array(lineSchema).min(1, "Siparişte en az bir satır olmalı.").max(300).parse(lines);

    const existing = await prisma.salesOrderLine.findMany({
      where: { salesOrderId: order.id },
      select: { id: true, model: true, deliveryDate: true, productionOrderId: true, _count: { select: { shipments: true } } },
    });
    const keep = new Set(ls.map((l) => l.id).filter(Boolean));
    for (const l of ls) if (l.id && !existing.some((e) => e.id === l.id)) throw new Error("Geçersiz satır.");
    const removed = existing.filter((e) => !keep.has(e.id));
    const removedPOs = removed.map((r) => r.productionOrderId).filter((x): x is string => !!x);
    const started = await startedProductionIds(removedPOs);
    const blocked = removed.find((e) => e._count.shipments > 0 || (e.productionOrderId && started.has(e.productionOrderId)));
    if (blocked) {
      throw new Error(`"${blocked.model}" satırı silinemez: sevkiyatı veya başlamış görevi var. Durumunu "İptal" yapabilirsiniz.`);
    }

    await prisma.$transaction([
      prisma.salesOrderLine.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } }),
      // Hiç başlamamış görevler satırla birlikte silinir
      prisma.productionOrder.deleteMany({ where: { id: { in: removedPOs } } }),
      ...ls.map((l, i) =>
        l.id
          ? prisma.salesOrderLine.update({ where: { id: l.id }, data: lineData(l, i) })
          : prisma.salesOrderLine.create({ data: { ...lineData(l, i), salesOrderId: order.id } }),
      ),
    ]);

    // Termini değişen satırların (henüz başlamamış) görev tarihleri yeniden hesaplanır
    const time = (d: Date | null) => d?.getTime() ?? null;
    for (const l of ls) {
      const prev = l.id ? existing.find((e) => e.id === l.id) : undefined;
      if (prev?.productionOrderId && time(prev.deliveryDate) !== time(l.deliveryDate)) await rescheduleLine(prev.id);
    }
    // Yeni (veya henüz görevi olmayan) açık satırlara görev açılır
    const pending = await prisma.salesOrderLine.findMany({
      where: { salesOrderId: order.id, productionOrderId: null, status: { in: ["RECEIVED", "IN_PRODUCTION"] } },
      select: { id: true },
      orderBy: { sortOrder: "asc" },
    });
    await openProductionForLines(pending.map((p) => p.id), s.uid);

    revalidatePath(`/sales/${order.id}`);
    revalidatePath("/orders");
    revalidatePath("/tasks");
    revalidatePath("/sales");
  });
}

async function deleteSalesOrderImpl(fd: FormData) {
  const s = await auth();
  const order = await manageableSales(s, String(fd.get("id")));
  // Hiç başlamamış görev takipleri siparişle birlikte silinir; başlamış olanlar korunur (yalnızca bağlantı kopar).
  const linked = (
    await prisma.salesOrderLine.findMany({ where: { salesOrderId: order.id, productionOrderId: { not: null } }, select: { productionOrderId: true } })
  ).map((l) => l.productionOrderId!);
  const started = await startedProductionIds(linked);
  await prisma.$transaction([
    prisma.salesOrder.delete({ where: { id: order.id } }),
    prisma.productionOrder.deleteMany({ where: { id: { in: linked.filter((x) => !started.has(x)) } } }),
  ]);
  revalidatePath("/orders");
  revalidatePath("/sales");
  redirect("/sales");
}
export async function deleteSalesOrder(_: FormState, fd: FormData) {
  return withFormState(() => deleteSalesOrderImpl(fd));
}

// ─── Sevkiyat ──────────────────────────────────────────────────

/** Tamamı sevk edilen satırı "Yüklendi" yapar. */
async function syncLineShipped(lineId: string) {
  const line = await prisma.salesOrderLine.findUniqueOrThrow({
    where: { id: lineId },
    include: { shipments: { select: { quantity: true } } },
  });
  const shipped = line.shipments.reduce((a, x) => a + x.quantity, 0);
  const total = sumQty(line.quantities);
  if (line.status !== "CANCELLED" && total > 0 && shipped >= total && line.status !== "SHIPPED") {
    await prisma.salesOrderLine.update({ where: { id: lineId }, data: { status: "SHIPPED" } });
  }
}

const shipmentSchema = z.object({
  lineId: z.string().min(1, "Satır seçilmeli."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sevk tarihi gerekli.").transform(parseDateInput),
  quantity: z.coerce.number().int("Adet tam sayı olmalı.").positive("Adet 0'dan büyük olmalı."),
  note: optText(300),
  /** İşaretliyse adet eksik olsa bile satır "Yüklendi" olur */
  markShipped: z.string().optional().transform((v) => v === "on"),
});

async function addShipmentImpl(fd: FormData) {
  const s = await auth();
  const d = shipmentSchema.parse(Object.fromEntries(fd));
  const line = await prisma.salesOrderLine.findFirst({ where: { id: d.lineId, salesOrder: salesScope(s) } });
  if (!line) throw new Error("Satır bulunamadı.");
  if (line.status === "CANCELLED") throw new Error("İptal edilmiş satıra yükleme girilemez.");
  await prisma.shipment.create({ data: { lineId: line.id, date: d.date, quantity: d.quantity, note: d.note } });
  if (d.markShipped) await prisma.salesOrderLine.update({ where: { id: line.id }, data: { status: "SHIPPED" } });
  else await syncLineShipped(line.id);
  revalidatePath(`/sales/${line.salesOrderId}`);
  revalidatePath("/sales");
}
export async function addShipment(_: FormState, fd: FormData) {
  return withFormState(() => addShipmentImpl(fd));
}

async function deleteShipmentImpl(fd: FormData) {
  const s = await auth();
  const sh = await prisma.shipment.findFirst({
    where: { id: String(fd.get("id")), line: { salesOrder: salesScope(s) } },
    include: { line: { select: { salesOrderId: true } } },
  });
  if (!sh) throw new Error("Sevkiyat bulunamadı.");
  await prisma.shipment.delete({ where: { id: sh.id } });
  revalidatePath(`/sales/${sh.line.salesOrderId}`);
  revalidatePath("/sales");
}
export async function deleteShipment(_: FormState, fd: FormData) {
  return withFormState(() => deleteShipmentImpl(fd));
}

// ─── Tahsilat ──────────────────────────────────────────────────

const paymentSchema = z.object({
  salesOrderId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tahsilat tarihi gerekli.").transform(parseDateInput),
  amount: decimal.refine((v) => v != null && v > 0, "Tutar 0'dan büyük olmalı."),
  currency: z.enum(Currency),
  rate: decimal,
  note: optText(300),
});

async function addPaymentImpl(fd: FormData) {
  const s = await auth();
  const d = paymentSchema.parse(Object.fromEntries(fd));
  const order = await manageableSales(s, d.salesOrderId);
  await prisma.payment.create({
    data: {
      salesOrderId: order.id,
      date: d.date,
      amount: d.amount!,
      currency: d.currency,
      rate: d.currency === "TRY" ? 1 : d.rate,
      note: d.note,
    },
  });
  revalidatePath(`/sales/${order.id}`);
  revalidatePath("/sales");
}
export async function addPayment(_: FormState, fd: FormData) {
  return withFormState(() => addPaymentImpl(fd));
}

async function deletePaymentImpl(fd: FormData) {
  const s = await auth();
  const p = await prisma.payment.findFirst({ where: { id: String(fd.get("id")), salesOrder: salesScope(s) } });
  if (!p) throw new Error("Tahsilat bulunamadı.");
  await prisma.payment.delete({ where: { id: p.id } });
  revalidatePath(`/sales/${p.salesOrderId}`);
  revalidatePath("/sales");
}
export async function deletePayment(_: FormState, fd: FormData) {
  return withFormState(() => deletePaymentImpl(fd));
}

// ─── Üretime açma ──────────────────────────────────────────────

/** Sipariş satırından seçilen ürün tipiyle üretim takibi ve görevleri oluşturur. */
async function openProductionImpl(fd: FormData) {
  const s = await auth();
  const line = await prisma.salesOrderLine.findFirst({
    where: { id: String(fd.get("lineId")), salesOrder: salesScope(s) },
  });
  if (!line) throw new Error("Satır bulunamadı.");
  if (line.productionOrderId) throw new Error("Bu satır zaten üretimde takip ediliyor.");
  if (line.status === "CANCELLED") throw new Error("İptal edilmiş satır üretime açılamaz.");
  if (sumQty(line.quantities) <= 0) throw new Error("Satırda adet yok.");

  const product = await prisma.productType.findFirst({ where: { id: String(fd.get("productTypeId")), active: true } });
  if (!product) throw new Error("Ürün tipi seçilmeli.");

  await openProductionForLine(line.id, s.uid, product.id);
  revalidatePath(`/sales/${line.salesOrderId}`);
  revalidatePath("/sales");
  revalidatePath("/orders");
  revalidatePath("/tasks");
}
export async function openProduction(_: FormState, fd: FormData) {
  return withFormState(() => openProductionImpl(fd));
}

/** Görevi olmayan açık (Alındı/Üretimde) satırlara standart görevleri toplu açar. */
async function openMissingProductionImpl() {
  const s = await auth();
  const lines = await prisma.salesOrderLine.findMany({
    where: { ...LINES_WITHOUT_TASKS, salesOrder: salesScope(s) },
    select: { id: true, productionOrderId: true },
    orderBy: [{ salesOrder: { orderDate: "asc" } }, { sortOrder: "asc" }],
  });
  await openProductionForLines(lines.filter((l) => !l.productionOrderId).map((l) => l.id), s.uid);
  // Daha önce elle üretime açılmış ama planı oluşturulmamış satırlar
  for (const l of lines) if (l.productionOrderId) await createTasksForLinkedLine(l.id);
  revalidatePath("/sales");
  revalidatePath("/orders");
  revalidatePath("/tasks");
}
export async function openMissingProduction(): Promise<FormState> {
  return withFormState(() => openMissingProductionImpl());
}
