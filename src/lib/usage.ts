import "server-only";
import { prisma } from "./db";

// Silmeyi engelleyen bağlı kayıtlar. Boş liste = silinebilir.

/** Silmeyi engelleyen kayıtların okunur listesi. Boşsa silinebilir. */
export async function orgUsage(id: string) {
  const c = await prisma.organization.findUniqueOrThrow({
    where: { id },
    select: {
      _count: {
        select: {
          users: true, children: true, ordersOwned: true, ordersAsClient: true,
          assignedTasks: true, salesOwned: true, salesAsClient: true,
        },
      },
    },
  });
  const n = c._count;
  return [
    n.users && `${n.users} kullanıcı`,
    n.children && `${n.children} bağlı firma/müşteri`,
    n.ordersOwned + n.ordersAsClient && `${n.ordersOwned + n.ordersAsClient} üretim siparişi`,
    n.salesOwned + n.salesAsClient && `${n.salesOwned + n.salesAsClient} sipariş`,
    n.assignedTasks && `${n.assignedTasks} görev`,
  ].filter(Boolean) as string[];
}

export async function userUsage(id: string) {
  const c = await prisma.user.findUniqueOrThrow({
    where: { id },
    select: { _count: { select: { assignedTasks: true, createdOrders: true, createdSales: true } } },
  });
  const n = c._count;
  return [
    n.assignedTasks && `${n.assignedTasks} görev`,
    n.createdOrders && `${n.createdOrders} üretim siparişi`,
    n.createdSales && `${n.createdSales} sipariş`,
  ].filter(Boolean) as string[];
}
