import "server-only";
import type { Currency, Prisma, SalesLineStatus } from "@prisma/client";
import { prisma } from "./db";
import type { SessionPayload } from "./jwt";
import { parseDateInput, today } from "./labels";
import { addTo, lineTotals, LINE_STATUSES } from "./sales";
import { salesScope } from "./scope";

export type SalesFilters = { q?: string; customer?: string; status?: string; from?: string; to?: string };

const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Liste ve Excel çıktısı için ortak sorgu. Satır bazında (Excel'deki gibi) döner. */
export async function querySalesLines(s: SessionPayload, f: SalesFilters) {
  const orderWhere: Prisma.SalesOrderWhereInput = {
    AND: [
      salesScope(s),
      f.customer ? { customerId: f.customer } : {},
      isDate(f.from) ? { orderDate: { gte: parseDateInput(f.from!) } } : {},
      isDate(f.to) ? { orderDate: { lte: parseDateInput(f.to!) } } : {},
    ],
  };
  const q = f.q?.trim();
  const statusWhere: Prisma.SalesOrderLineWhereInput =
    f.status === "open"
      ? { status: { in: ["RECEIVED", "IN_PRODUCTION"] } }
      : f.status === "late"
        ? {
            status: { in: ["RECEIVED", "IN_PRODUCTION"] },
            productionOrder: { tasks: { some: { status: { not: "DONE" }, dueDate: { lt: today() } } } },
          }
      : LINE_STATUSES.includes(f.status as SalesLineStatus)
        ? { status: f.status as SalesLineStatus }
        : {};

  const lines = await prisma.salesOrderLine.findMany({
    where: {
      AND: [
        { salesOrder: orderWhere },
        statusWhere,
        q
          ? {
              OR: [
                { model: { contains: q, mode: "insensitive" } },
                { color: { contains: q, mode: "insensitive" } },
                { fabric: { contains: q, mode: "insensitive" } },
                { salesOrder: { code: { contains: q, mode: "insensitive" } } },
                { salesOrder: { customerOrderNo: { contains: q, mode: "insensitive" } } },
                { salesOrder: { customer: { name: { contains: q, mode: "insensitive" } } } },
              ],
            }
          : {},
      ],
    },
    include: {
      sizeSet: { select: { code: true, sizes: true } },
      shipments: { select: { quantity: true, date: true }, orderBy: { date: "desc" } },
      salesOrder: {
        select: {
          id: true, code: true, orderDate: true, currency: true, customerOrderNo: true,
          customer: { select: { name: true } },
        },
      },
      productionOrder: {
        select: {
          id: true,
          code: true,
          status: true,
          tasks: {
            select: {
              status: true,
              dueDate: true,
              completedAt: true,
              process: { select: { id: true, name: true, sortOrder: true } },
            },
          },
        },
      },
    },
    orderBy: [{ salesOrder: { orderDate: "desc" } }, { salesOrder: { code: "desc" } }, { sortOrder: "asc" }],
  });

  const rows = lines.map((l) => {
    const unitPrice = l.unitPrice != null ? Number(l.unitPrice) : null;
    return { ...l, unitPrice, totals: lineTotals({ ...l, unitPrice }) };
  });

  // Tahsilatlar: listede satırı görünen siparişlerin tahsilatları
  const orderIds = [...new Set(rows.map((r) => r.salesOrder.id))];
  const payments = orderIds.length
    ? await prisma.payment.findMany({ where: { salesOrderId: { in: orderIds } }, select: { amount: true, currency: true } })
    : [];

  const totals = {
    qty: 0,
    shippedQty: 0,
    amount: {} as Partial<Record<Currency, number>>,
    shipped: {} as Partial<Record<Currency, number>>,
    received: {} as Partial<Record<Currency, number>>,
  };
  for (const r of rows) {
    totals.qty += r.totals.qty;
    totals.shippedQty += r.totals.shippedQty;
    addTo(totals.amount, r.salesOrder.currency, r.totals.amount);
    addTo(totals.shipped, r.salesOrder.currency, r.totals.shippedAmount);
  }
  for (const p of payments) addTo(totals.received, p.currency, Number(p.amount));

  return { rows, totals, orderCount: orderIds.length };
}
