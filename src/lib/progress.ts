import type { TaskStatus } from "@prisma/client";
import { prisma } from "./db";

type TaskLite = {
  status: TaskStatus;
  componentId: string | null;
  process: { id: string; name: string; sortOrder: number };
};

/** Sipariş ilerleme yüzdesi (tamamlanan görev / toplam görev). */
export function orderProgress(tasks: { status: TaskStatus }[]) {
  if (tasks.length === 0) return 0;
  return Math.round((tasks.filter((t) => t.status === "DONE").length / tasks.length) * 100);
}

/** Siparişin bulunduğu aşama: tamamlanmamış görevi olan ilk işlem. */
export function currentStage(tasks: TaskLite[]) {
  const open = tasks
    .filter((t) => t.status !== "DONE")
    .sort((a, b) => a.process.sortOrder - b.process.sortOrder);
  if (tasks.length === 0) return null;
  if (open.length === 0) return "DONE" as const;
  return open[0].process;
}

/** Bir parçanın şu an hangi işlemde olduğu. */
export function componentStage(componentId: string, tasks: TaskLite[]) {
  const own = tasks
    .filter((t) => t.componentId === componentId)
    .sort((a, b) => a.process.sortOrder - b.process.sortOrder);
  if (own.length === 0) return { label: "İşlem atanmadı", state: "none" as const };
  const open = own.find((t) => t.status !== "DONE");
  if (!open) return { label: "Tüm işlemleri bitti", state: "done" as const };
  return {
    label: open.process.name,
    state: open.status === "IN_PROGRESS" ? ("active" as const) : open.status === "BLOCKED" ? ("blocked" as const) : ("waiting" as const),
  };
}

/** İşlem bazında özet: her işlemin kaç görevi var, kaçı bitti. */
export function processSummary(
  processes: { id: string; name: string; sortOrder: number }[],
  tasks: TaskLite[],
) {
  return processes.map((p) => {
    const ts = tasks.filter((t) => t.process.id === p.id);
    const done = ts.filter((t) => t.status === "DONE").length;
    const active = ts.some((t) => t.status === "IN_PROGRESS");
    const blocked = ts.some((t) => t.status === "BLOCKED");
    const state =
      ts.length === 0 ? "skip" : done === ts.length ? "done" : blocked ? "blocked" : active || done > 0 ? "active" : "waiting";
    return { ...p, total: ts.length, done, state };
  });
}

/** Görev değişikliğinden sonra sipariş durumunu otomatik günceller. */
export async function syncOrderStatus(orderId: string) {
  const order = await prisma.productionOrder.findUnique({
    where: { id: orderId },
    select: { status: true, tasks: { select: { status: true } } },
  });
  if (!order || order.status === "CANCELLED" || order.status === "DRAFT") return;
  const { tasks } = order;
  let next = order.status;
  if (tasks.length > 0 && tasks.every((t) => t.status === "DONE")) next = "COMPLETED";
  else if (tasks.some((t) => t.status === "IN_PROGRESS" || t.status === "DONE")) next = "IN_PRODUCTION";
  else next = "PLANNING";
  if (next !== order.status) {
    await prisma.productionOrder.update({ where: { id: orderId }, data: { status: next } });
  }
}
