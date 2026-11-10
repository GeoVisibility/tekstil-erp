import "server-only";
import type { Prisma } from "@prisma/client";
import { nextOrderCode } from "./codes";
import { prisma } from "./db";
import { today } from "./labels";
import { sumQty } from "./sales";

const DAY = 86400000;

/**
 * Sipariş listesinden açılan her satır için kullanılan standart iş akışı (Mutlu Bey'in adımları).
 * Süreler varsayılandır; Ürünler > Standart sipariş sayfasından değiştirilebilir.
 */
export const STANDARD_PRODUCT_CODE = "STD";
const STANDARD_PROCESSES = [
  { name: "Kumaş", days: 7 },
  { name: "Aksesuar", days: 5 },
  { name: "Yardımcı malzeme", days: 3 },
  { name: "Kesim", days: 3 },
  { name: "Dikim", days: 7 },
  { name: "Kutu / Paket", days: 2 },
];

/** Standart ürün tipini getirir; yoksa adımlarıyla birlikte oluşturur. */
export async function ensureStandardProductType() {
  const found = await prisma.productType.findUnique({ where: { code: STANDARD_PRODUCT_CODE } });
  if (found) return found;
  return prisma.productType.create({
    data: {
      code: STANDARD_PRODUCT_CODE,
      name: "Standart sipariş",
      description: "Sipariş listesindeki her satır için otomatik açılan görevler.",
      processes: {
        create: STANDARD_PROCESSES.map((p, i) => ({ name: p.name, sortOrder: i, defaultDurationDays: p.days })),
      },
    },
  });
}

type Proc = { id: string; defaultDurationDays: number; componentCategories: string[] };
type Comp = { id: string; category: string };

/**
 * İşlem şablonlarından görevleri tarihleriyle hesaplar.
 * Termin varsa son adım termin günü biter ve geriye doğru dizilir; yoksa başlangıçtan ileri doğru.
 */
export function planTasks(orderId: string, processes: Proc[], components: Comp[], opts: { start?: Date | null; end?: Date | null }) {
  const steps = processes
    .map((p) => ({
      p,
      targets: p.componentCategories.length ? components.filter((c) => p.componentCategories.includes(c.category)) : [null],
    }))
    .filter((x) => x.targets.length > 0); // örn. siparişte nakış yoksa Nakış adımı atlanır

  const days = (p: Proc) => Math.max(1, p.defaultDurationDays);
  const total = steps.reduce((a, s) => a + days(s.p), 0);
  let cursor = opts.end && !opts.start ? opts.end.getTime() - (total - 1) * DAY : (opts.start ?? today()).getTime();

  const tasks: Prisma.TaskCreateManyInput[] = [];
  for (const { p, targets } of steps) {
    const startDate = new Date(cursor);
    const dueDate = new Date(cursor + (days(p) - 1) * DAY);
    for (const c of targets) tasks.push({ orderId, processId: p.id, componentId: c?.id ?? null, startDate, dueDate });
    cursor += days(p) * DAY;
  }
  return tasks;
}

/**
 * Sipariş satırı için üretim takibi + görevleri oluşturur.
 * Zaten takipte olan, iptal edilmiş veya adedi olmayan satırlar atlanır (null döner).
 */
export async function openProductionForLine(lineId: string, userId: string | null, productTypeId?: string) {
  const line = await prisma.salesOrderLine.findUnique({
    where: { id: lineId },
    include: { salesOrder: true, sizeSet: true },
  });
  if (!line || line.productionOrderId || line.status === "CANCELLED") return null;
  const quantity = sumQty(line.quantities);
  if (quantity <= 0) return null;

  const productId = productTypeId ?? (await ensureStandardProductType()).id;
  const product = await prisma.productType.findUniqueOrThrow({
    where: { id: productId },
    include: {
      components: { where: { required: true }, orderBy: { sortOrder: "asc" } },
      processes: { orderBy: { sortOrder: "asc" } },
    },
  });

  const sizeBreakdown = Object.fromEntries(
    line.quantities.map((q, i) => [line.sizeSet?.sizes[i] || `#${i + 1}`, q] as const).filter(([, q]) => q > 0),
  );
  const so = line.salesOrder;

  const po = await prisma.productionOrder.create({
    data: {
      code: await nextOrderCode(),
      modelName: line.model,
      productTypeId: product.id,
      companyId: so.companyId,
      customerId: so.customerId,
      quantity,
      color: line.color,
      sizeBreakdown,
      dueDate: line.deliveryDate,
      notes: [`Sipariş ${so.code}${so.customerOrderNo ? ` / ${so.customerOrderNo}` : ""}`, line.fabric && `Kumaş: ${line.fabric}`]
        .filter(Boolean)
        .join("\n"),
      createdById: userId,
      components: {
        create: product.components.map((t, i) => ({
          template: { connect: { id: t.id } },
          name: t.name,
          category: t.category,
          // Ana kumaş için siparişteki kumaş bilgisi kullanılır
          spec: t.category === "FABRIC" && i === 0 && line.fabric ? line.fabric : t.defaultSpec,
          unit: t.defaultUnit,
          quantity: t.perUnitQty ? Math.ceil(t.perUnitQty * quantity * 100) / 100 : null,
          sortOrder: i,
        })),
      },
    },
    include: { components: { select: { id: true, category: true } } },
  });

  const tasks = planTasks(po.id, product.processes, po.components, {
    end: line.deliveryDate,
    start: line.deliveryDate ? null : so.orderDate,
  });
  if (tasks.length) await prisma.task.createMany({ data: tasks });

  await prisma.salesOrderLine.update({ where: { id: line.id }, data: { productionOrderId: po.id } });
  return po;
}

/** Birden çok satırı sırayla üretime açar (sipariş kodu çakışmasın diye sıralı). */
export async function openProductionForLines(lineIds: string[], userId: string | null) {
  let n = 0;
  for (const id of lineIds) if (await openProductionForLine(id, userId)) n++;
  return n;
}

/** Üretime açılmış ama hiç görevi olmayan satırın görevlerini ürün tipinin şablonundan oluşturur. */
export async function createTasksForLinkedLine(lineId: string) {
  const line = await prisma.salesOrderLine.findUnique({
    where: { id: lineId },
    select: {
      deliveryDate: true,
      salesOrder: { select: { orderDate: true } },
      productionOrder: {
        select: { id: true, productTypeId: true, components: { select: { id: true, category: true } }, _count: { select: { tasks: true } } },
      },
    },
  });
  const po = line?.productionOrder;
  if (!line || !po || po._count.tasks > 0) return false;
  const processes = await prisma.processTemplate.findMany({ where: { productTypeId: po.productTypeId }, orderBy: { sortOrder: "asc" } });
  const tasks = planTasks(po.id, processes, po.components, {
    end: line.deliveryDate,
    start: line.deliveryDate ? null : line.salesOrder.orderDate,
  });
  if (tasks.length) await prisma.task.createMany({ data: tasks });
  return tasks.length > 0;
}

/** Görevi olmayan açık satırların filtresi (takibi yok veya takibi var ama görevi yok). */
export const LINES_WITHOUT_TASKS = {
  status: { in: ["RECEIVED", "IN_PRODUCTION"] },
  OR: [{ productionOrderId: null }, { productionOrder: { tasks: { none: {} } } }],
} satisfies Prisma.SalesOrderLineWhereInput;

/**
 * Termin değişince, henüz hiçbir görevi başlamamış takibin görev tarihlerini yeniden hesaplar.
 * Atamalar korunur; yalnızca başlangıç/bitiş tarihleri güncellenir.
 */
export async function rescheduleLine(lineId: string) {
  const line = await prisma.salesOrderLine.findUnique({
    where: { id: lineId },
    select: {
      deliveryDate: true,
      salesOrder: { select: { orderDate: true } },
      productionOrder: {
        select: {
          id: true,
          productTypeId: true,
          components: { select: { id: true, category: true } },
          tasks: { select: { id: true, status: true, processId: true, componentId: true } },
        },
      },
    },
  });
  const po = line?.productionOrder;
  if (!line || !po || po.tasks.some((t) => t.status !== "PENDING")) return;
  const processes = await prisma.processTemplate.findMany({ where: { productTypeId: po.productTypeId }, orderBy: { sortOrder: "asc" } });
  const plan = planTasks(po.id, processes, po.components, {
    end: line.deliveryDate,
    start: line.deliveryDate ? null : line.salesOrder.orderDate,
  });
  await prisma.$transaction([
    prisma.productionOrder.update({ where: { id: po.id }, data: { dueDate: line.deliveryDate } }),
    ...po.tasks.flatMap((t) => {
      const p = plan.find((x) => x.processId === t.processId && (x.componentId ?? null) === t.componentId);
      return p ? [prisma.task.update({ where: { id: t.id }, data: { startDate: p.startDate, dueDate: p.dueDate } })] : [];
    }),
  ]);
}

/** Verilen üretim takiplerinden, en az bir görevi başlamış/bitmiş olanların id'leri. */
export async function startedProductionIds(ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await prisma.task.findMany({
    where: { orderId: { in: ids }, status: { not: "PENDING" } },
    select: { orderId: true },
    distinct: ["orderId"],
  });
  return new Set(rows.map((r) => r.orderId));
}

/** Görev başlayınca/bitince bağlı sipariş satırını "Alındı" → "Üretimde" yapar. */
export async function syncLineFromTasks(productionOrderId: string) {
  const line = await prisma.salesOrderLine.findUnique({
    where: { productionOrderId },
    select: { id: true, status: true, productionOrder: { select: { tasks: { select: { status: true } } } } },
  });
  if (!line || line.status !== "RECEIVED") return;
  if (line.productionOrder?.tasks.some((t) => t.status === "IN_PROGRESS" || t.status === "DONE")) {
    await prisma.salesOrderLine.update({ where: { id: line.id }, data: { status: "IN_PRODUCTION" } });
  }
}
