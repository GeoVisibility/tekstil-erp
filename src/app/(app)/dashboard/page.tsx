import { today as todayDate } from "@/lib/labels";
import Link from "next/link";
import { OrderTable, orderRowInclude } from "@/components/OrderTable";
import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/roles";
import { orderScope, taskScope } from "@/lib/scope";
import { requireSession } from "@/lib/session";

function Stat({ label, value, href, tone = "text-slate-900" }: { label: string; value: number; href?: string; tone?: string }) {
  const body = (
    <div className="card card-pad h-full transition hover:shadow-md">
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const s = await requireSession();
  const { denied } = await searchParams;
  const today = todayDate();
  const tScope = taskScope(s);
  const activeOrder = { order: { status: { not: "CANCELLED" as const } } };

  const [activeOrders, openTasks, inProgress, lateTasks, recent] = await Promise.all([
    prisma.productionOrder.count({ where: { ...orderScope(s), status: { in: ["PLANNING", "IN_PRODUCTION"] } } }),
    prisma.task.count({ where: { AND: [tScope, activeOrder, { status: { not: "DONE" } }] } }),
    prisma.task.count({ where: { AND: [tScope, activeOrder, { status: "IN_PROGRESS" }] } }),
    prisma.task.count({ where: { AND: [tScope, activeOrder, { status: { not: "DONE" } }, { dueDate: { lt: today } }] } }),
    s.role === "SUBCOMPANY"
      ? Promise.resolve([])
      : prisma.productionOrder.findMany({
          where: { ...orderScope(s), status: { not: "CANCELLED" } },
          include: orderRowInclude,
          orderBy: { updatedAt: "desc" },
          take: 8,
        }),
  ]);

  const tasksHref = s.role === "CUSTOMER" ? undefined : "/tasks";

  return (
    <>
      {denied && (
        <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Bu sayfayı görüntüleme yetkiniz yok.</div>
      )}
      <PageHeader title={`Hoş geldiniz, ${s.name}`} subtitle={`${ROLE_LABELS[s.role]} paneli`} />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Aktif sipariş" value={activeOrders} href={s.role === "SUBCOMPANY" ? undefined : "/orders"} />
        <Stat label="Açık görev" value={openTasks} href={tasksHref} />
        <Stat label="Devam eden görev" value={inProgress} href={tasksHref && "/tasks?f=IN_PROGRESS"} tone="text-amber-600" />
        <Stat label="Geciken görev" value={lateTasks} href={tasksHref} tone={lateTasks ? "text-red-600" : "text-slate-900"} />
      </div>

      {s.role !== "SUBCOMPANY" && (
        <>
          <h2 className="mb-3 font-semibold">Son güncellenen siparişler</h2>
          <OrderTable orders={recent} />
        </>
      )}
      {s.role === "SUBCOMPANY" && (
        <Link href="/tasks" className="btn-primary">Görevlerime git →</Link>
      )}
    </>
  );
}
