import Link from "next/link";
import { notFound } from "next/navigation";
import { TaskStatusButtons } from "@/components/TaskStatusButtons";
import { Badge, Empty, PageHeader, ProgressBar, StagePipeline } from "@/components/ui";
import { prisma } from "@/lib/db";
import {
  CATEGORY_LABELS,
  ORDER_STATUS,
  SUPPLY_STATUS,
  TASK_STATUS,
  formatDate,
  toInputDate,
  type Tone,
} from "@/lib/labels";
import { componentStage, orderProgress, processSummary } from "@/lib/progress";
import { canManage } from "@/lib/roles";
import { orderScope } from "@/lib/scope";
import { requireSession } from "@/lib/session";
import { cancelOrder, createTask, deleteTask, generatePlan, updateComponent, updateTask } from "../actions";

const STAGE_TONE: Record<string, Tone> = { none: "gray", done: "green", active: "amber", blocked: "red", waiting: "blue" };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();

  const order = await prisma.productionOrder.findFirst({
    where: { id, ...orderScope(s) },
    include: {
      productType: { include: { processes: { orderBy: { sortOrder: "asc" } } } },
      company: true,
      customer: true,
      components: { orderBy: { sortOrder: "asc" } },
      tasks: {
        include: {
          process: true,
          component: { select: { id: true, name: true } },
          assigneeUser: { select: { id: true, name: true } },
          assigneeOrg: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!order) notFound();

  const manage = canManage(s.role) && order.status !== "CANCELLED";
  const tasks = [...order.tasks].sort(
    (a, b) =>
      a.process.sortOrder - b.process.sortOrder ||
      (order.components.findIndex((c) => c.id === a.componentId) - order.components.findIndex((c) => c.id === b.componentId)),
  );
  const progress = orderProgress(tasks);
  const stages = processSummary(order.productType.processes, tasks);

  // Atanabilir kişiler: firma + alt firmaların kullanıcıları
  const [assignableOrgs, assignableUsers] = manage
    ? await Promise.all([
        prisma.organization.findMany({
          where: { parentId: order.companyId, type: "SUBCOMPANY" },
          orderBy: { name: "asc" },
        }),
        prisma.user.findMany({
          where: {
            active: true,
            organization: { OR: [{ id: order.companyId }, { parentId: order.companyId, type: "SUBCOMPANY" }] },
          },
          include: { organization: { select: { name: true } } },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], []];

  // Alt firma yalnızca kendine ait görevlerin durumunu değiştirebilir
  const canChangeStatus = (t: (typeof tasks)[number]) =>
    order.status !== "CANCELLED" &&
    (canManage(s.role) || (s.role === "SUBCOMPANY" && (t.assigneeOrgId === s.orgId || t.assigneeUserId === s.uid)));

  const sizes = (order.sizeBreakdown ?? {}) as Record<string, number>;

  return (
    <>
      <PageHeader
        title={`${order.code} · ${order.modelName}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={ORDER_STATUS[order.status].tone}>{ORDER_STATUS[order.status].label}</Badge>
            <span>{order.productType.name}</span>
            <span>·</span>
            <span>{order.company.name}</span>
          </span>
        }
        actions={
          <>
            <Link href="/orders" className="btn">← Siparişler</Link>
            {manage && (
              <form action={cancelOrder}>
                <input type="hidden" name="orderId" value={order.id} />
                <button className="btn text-red-600">Siparişi iptal et</button>
              </form>
            )}
          </>
        }
      />

      {/* Özet */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <section className="card card-pad lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Üretim aşamaları</h2>
            <ProgressBar value={progress} className="w-48" />
          </div>
          {tasks.length ? <StagePipeline stages={stages} /> : <Empty>Henüz görev planı yok.</Empty>}
        </section>
        <section className="card card-pad">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <dt className="text-slate-500">Müşteri</dt>
            <dd className="font-medium">{order.customer?.name ?? "—"}</dd>
            <dt className="text-slate-500">Adet</dt>
            <dd className="font-medium">{order.quantity.toLocaleString("tr-TR")}</dd>
            <dt className="text-slate-500">Renk</dt>
            <dd className="font-medium">{order.color ?? "—"}</dd>
            <dt className="text-slate-500">Termin</dt>
            <dd className="font-medium">{formatDate(order.dueDate)}</dd>
            <dt className="text-slate-500">Bedenler</dt>
            <dd className="font-medium">
              {Object.keys(sizes).length ? Object.entries(sizes).map(([k, v]) => `${k}:${v}`).join(" · ") : "—"}
            </dd>
          </dl>
          {order.notes && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{order.notes}</p>}
        </section>
      </div>

      {/* Parçalar */}
      <section className="card mb-6 overflow-x-auto">
        <div className="card-pad pb-3">
          <h2 className="font-semibold">Parçalar ve malzemeler</h2>
          <p className="text-sm text-slate-500">Her parçanın tedarik durumu ve şu an hangi işlemde olduğu</p>
        </div>
        <table className="w-full min-w-[900px]">
          <thead className="border-y border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Parça</th>
              <th className="th">Detay</th>
              <th className="th text-right">Miktar</th>
              <th className="th">Bulunduğu işlem</th>
              <th className="th">Tedarik</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {order.components.map((c) => {
              const stage = componentStage(c.id, tasks);
              return (
                <tr key={`${c.id}-${c.supplyStatus}-${c.supplier ?? ""}`}>
                  <td className="td">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-slate-500">{CATEGORY_LABELS[c.category]}</div>
                  </td>
                  <td className="td text-slate-600">
                    {c.spec ?? "—"}
                    {c.color && <div className="text-xs">Renk: {c.color}</div>}
                  </td>
                  <td className="td whitespace-nowrap text-right tabular-nums">
                    {c.quantity != null ? `${c.quantity.toLocaleString("tr-TR")} ${c.unit ?? ""}` : "—"}
                  </td>
                  <td className="td">
                    <Badge tone={STAGE_TONE[stage.state]}>{stage.label}</Badge>
                  </td>
                  <td className="td">
                    {manage ? (
                      <form action={updateComponent} className="flex flex-wrap items-center gap-1">
                        <input type="hidden" name="componentId" value={c.id} />
                        <select name="supplyStatus" defaultValue={c.supplyStatus} className="input-sm">
                          {Object.entries(SUPPLY_STATUS).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                        <input name="supplier" defaultValue={c.supplier ?? ""} placeholder="Tedarikçi" className="input-sm w-28" />
                        <button className="btn btn-xs">Kaydet</button>
                      </form>
                    ) : (
                      <Badge tone={SUPPLY_STATUS[c.supplyStatus].tone}>{SUPPLY_STATUS[c.supplyStatus].label}</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Görevler */}
      <section className="card overflow-x-auto">
        <div className="card-pad flex flex-wrap items-end justify-between gap-3 pb-3">
          <div>
            <h2 className="font-semibold">Görevler</h2>
            <p className="text-sm text-slate-500">Hangi parçanın hangi işlemde, kim tarafından, ne zaman yapılacağı</p>
          </div>
          {manage && tasks.length === 0 && (
            <form action={generatePlan} className="flex items-end gap-2">
              <input type="hidden" name="orderId" value={order.id} />
              <div>
                <label className="label">Plan başlangıcı</label>
                <input type="date" name="startDate" className="input" defaultValue={toInputDate(new Date())} />
              </div>
              <button className="btn-primary">Planı otomatik oluştur</button>
            </form>
          )}
        </div>

        {tasks.length > 0 && (
          <table className="w-full min-w-[1100px]">
            <thead className="border-y border-slate-200 bg-slate-50">
              <tr>
                <th className="th">İşlem</th>
                <th className="th">Parça</th>
                <th className="th">Atanan</th>
                <th className="th">Tarih</th>
                <th className="th">Durum</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.map((t) => {
                const formId = `task-${t.id}`;
                return (
                  // updatedAt key'i: kayıttan sonra satır yeni değerlerle yeniden oluşur (React 19 form reset'i)
                  <tr key={`${t.id}-${t.updatedAt.getTime()}`} className={t.status === "DONE" ? "bg-emerald-50/40" : ""}>
                    <td className="td font-medium">{t.process.name}</td>
                    <td className="td">{t.component?.name ?? <span className="text-slate-400">Ürünün tamamı</span>}</td>
                    <td className="td">
                      {manage ? (
                        <div className="flex flex-col gap-1">
                          <select name="assigneeOrgId" form={formId} defaultValue={t.assigneeOrgId ?? ""} className="input-sm">
                            <option value="">— Alt firma (iç üretim) —</option>
                            {assignableOrgs.map((o) => (
                              <option key={o.id} value={o.id}>{o.name}</option>
                            ))}
                          </select>
                          <select name="assigneeUserId" form={formId} defaultValue={t.assigneeUserId ?? ""} className="input-sm">
                            <option value="">— Sorumlu kişi —</option>
                            {assignableUsers.map((u) => (
                              <option key={u.id} value={u.id}>{u.name} ({u.organization?.name})</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="text-sm">
                          {t.assigneeOrg?.name ?? "—"}
                          {t.assigneeUser && <div className="text-xs text-slate-500">{t.assigneeUser.name}</div>}
                        </div>
                      )}
                    </td>
                    <td className="td">
                      {manage ? (
                        <div className="flex flex-col gap-1">
                          <input type="date" name="startDate" form={formId} defaultValue={toInputDate(t.startDate)} className="input-sm" />
                          <input type="date" name="dueDate" form={formId} defaultValue={toInputDate(t.dueDate)} className="input-sm" />
                        </div>
                      ) : (
                        <div className="whitespace-nowrap text-xs">
                          {formatDate(t.startDate)} → {formatDate(t.dueDate)}
                        </div>
                      )}
                    </td>
                    <td className="td">
                      <div className="flex flex-col items-start gap-1.5">
                        <Badge tone={TASK_STATUS[t.status].tone}>{TASK_STATUS[t.status].label}</Badge>
                        {t.completedAt && <span className="text-[11px] text-slate-500">{formatDate(t.completedAt)}</span>}
                        {canChangeStatus(t) && <TaskStatusButtons taskId={t.id} status={t.status} />}
                      </div>
                    </td>
                    <td className="td">
                      {manage && (
                        <div className="flex flex-col items-end gap-1">
                          <form id={formId} action={updateTask}>
                            <input type="hidden" name="taskId" value={t.id} />
                            <button className="btn btn-xs">Kaydet</button>
                          </form>
                          <form action={deleteTask}>
                            <input type="hidden" name="taskId" value={t.id} />
                            <button className="btn btn-xs text-red-600">Sil</button>
                          </form>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {manage && (
          <form action={createTask} className="card-pad grid gap-3 border-t border-slate-200 bg-slate-50/60 sm:grid-cols-2 lg:grid-cols-6">
            <input type="hidden" name="orderId" value={order.id} />
            <div className="sm:col-span-2 lg:col-span-6 text-sm font-semibold">Görev ekle</div>
            <div>
              <label className="label">İşlem *</label>
              <select name="processId" className="input" required>
                {order.productType.processes.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Parça</label>
              <select name="componentId" className="input">
                <option value="">Ürünün tamamı</option>
                {order.components.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Alt firma</label>
              <select name="assigneeOrgId" className="input">
                <option value="">— İç üretim —</option>
                {assignableOrgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Sorumlu</label>
              <select name="assigneeUserId" className="input">
                <option value="">—</option>
                {assignableUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Başlangıç</label>
              <input type="date" name="startDate" className="input" />
            </div>
            <div>
              <label className="label">Bitiş</label>
              <input type="date" name="dueDate" className="input" />
            </div>
            <div className="sm:col-span-2 lg:col-span-5">
              <input name="note" className="input" placeholder="Not (opsiyonel)" />
            </div>
            <button className="btn-primary">Görevi ekle</button>
          </form>
        )}
      </section>
    </>
  );
}
