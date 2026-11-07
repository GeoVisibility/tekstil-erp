import { today as todayDate } from "@/lib/labels";
import Link from "next/link";
import type { Prisma, TaskStatus } from "@prisma/client";
import { TaskStatusButtons } from "@/components/TaskStatusButtons";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { TASK_STATUS, formatDate } from "@/lib/labels";
import { taskScope } from "@/lib/scope";
import { requireSession } from "@/lib/session";

const FILTERS: { key: string; label: string; where: Prisma.TaskWhereInput }[] = [
  { key: "open", label: "Açık", where: { status: { not: "DONE" } } },
  { key: "IN_PROGRESS", label: "Devam eden", where: { status: "IN_PROGRESS" } },
  { key: "DONE", label: "Tamamlanan", where: { status: "DONE" } },
  { key: "all", label: "Tümü", where: {} },
];

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ f?: string; mine?: string }> }) {
  const s = await requireSession();
  const { f = "open", mine } = await searchParams;
  const filter = FILTERS.find((x) => x.key === f) ?? FILTERS[0];

  // Firma kullanıcıları "yalnızca bana atananlar" filtresini kullanabilir
  const onlyMine = mine === "1" || s.role === "SUBCOMPANY";
  const tasks = await prisma.task.findMany({
    where: {
      AND: [
        taskScope(s),
        filter.where,
        { order: { status: { not: "CANCELLED" } } },
        onlyMine && s.role !== "SUBCOMPANY" ? { assigneeUserId: s.uid } : {},
      ],
    },
    include: {
      process: true,
      component: { select: { name: true } },
      order: { select: { id: true, code: true, modelName: true, quantity: true } },
      assigneeOrg: { select: { name: true } },
      assigneeUser: { select: { name: true } },
    },
    orderBy: [{ dueDate: "asc" }, { process: { sortOrder: "asc" } }],
  });

  const today = todayDate();
  const qs = (o: Record<string, string | undefined>) =>
    "?" + new URLSearchParams(Object.entries({ f, mine, ...o }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <PageHeader title="Görevlerim" subtitle={`${tasks.length} görev`} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((x) => (
          <Link key={x.key} href={qs({ f: x.key })} className={`btn btn-xs ${x.key === filter.key ? "!border-indigo-500 !text-indigo-700" : ""}`}>
            {x.label}
          </Link>
        ))}
        {s.role !== "SUBCOMPANY" && (
          <Link href={qs({ mine: onlyMine ? undefined : "1" })} className={`btn btn-xs ${onlyMine ? "!border-indigo-500 !text-indigo-700" : ""}`}>
            {onlyMine ? "✓ " : ""}Yalnızca bana atananlar
          </Link>
        )}
      </div>

      {tasks.length === 0 ? (
        <Empty>Bu filtrede görev yok.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Sipariş</th>
                <th className="th">İşlem / Parça</th>
                <th className="th">Atanan</th>
                <th className="th">Tarih</th>
                <th className="th">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.map((t) => {
                const late = t.dueDate && t.status !== "DONE" && t.dueDate < today;
                return (
                  <tr key={t.id}>
                    <td className="td">
                      {s.role === "SUBCOMPANY" ? (
                        <span className="font-medium">{t.order.code}</span>
                      ) : (
                        <Link href={`/orders/${t.order.id}`} className="font-medium text-indigo-700 hover:underline">{t.order.code}</Link>
                      )}
                      <div className="text-xs text-slate-500">{t.order.modelName} · {t.order.quantity} adet</div>
                    </td>
                    <td className="td">
                      <div className="font-medium">{t.process.name}</div>
                      <div className="text-xs text-slate-500">{t.component?.name ?? "Ürünün tamamı"}</div>
                      {t.note && <div className="mt-1 text-xs text-slate-600">📝 {t.note}</div>}
                    </td>
                    <td className="td text-sm">
                      {t.assigneeOrg?.name ?? "İç üretim"}
                      {t.assigneeUser && <div className="text-xs text-slate-500">{t.assigneeUser.name}</div>}
                    </td>
                    <td className={`td whitespace-nowrap text-xs ${late ? "font-semibold text-red-600" : ""}`}>
                      {formatDate(t.startDate)} → {formatDate(t.dueDate)}
                      {late && <div>Gecikti</div>}
                    </td>
                    <td className="td">
                      <div className="flex flex-col items-start gap-1.5">
                        <Badge tone={TASK_STATUS[t.status as TaskStatus].tone}>{TASK_STATUS[t.status as TaskStatus].label}</Badge>
                        {s.role !== "CUSTOMER" && <TaskStatusButtons taskId={t.id} status={t.status} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
