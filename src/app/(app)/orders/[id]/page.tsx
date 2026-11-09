import { ActionForm } from "@/components/ActionForm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TaskStatusButtons } from "@/components/TaskStatusButtons";
import { Badge, Empty, PageHeader, ProgressBar, StagePipeline } from "@/components/ui";
import { prisma } from "@/lib/db";
import {
  CATEGORY_LABELS,
  ORDER_STATUS,
  TASK_STATUS,
  formatDate,
  toInputDate,
  type Tone,
} from "@/lib/labels";
import { componentStage, orderProgress, processSummary } from "@/lib/progress";
import { canManage } from "@/lib/roles";
import { orderScope } from "@/lib/scope";
import { requireSession } from "@/lib/session";
import { cancelOrder, createTask, deleteTask, generatePlan, updateTask } from "../actions";
import { ComponentsEditor } from "@/components/ComponentsEditor";

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
          where: { parentId: order.companyId, type: "SUBCOMPANY", active: true },
          orderBy: { name: "asc" },
        }),
        prisma.user.findMany({
          where: {
            active: true,
            organization: { active: true, OR: [{ id: order.companyId }, { parentId: order.companyId, type: "SUBCOMPANY" }] },
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
              <ActionForm action={cancelOrder}>
                <input type="hidden" name="orderId" value={order.id} />
                <button className="btn text-red-600">Siparişi iptal et</button>
              </ActionForm>
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

      {/* Parçalar: değişiklikler toplu kaydedilir */}
      <ComponentsEditor
        orderId={order.id}
        editable={manage}
        rows={order.components.map((c) => {
          const stage = componentStage(c.id, tasks);
          return {
            id: c.id,
            name: c.name,
            categoryLabel: CATEGORY_LABELS[c.category],
            spec: c.spec,
            color: c.color,
            quantityText: c.quantity != null ? `${c.quantity.toLocaleString("tr-TR")} ${c.unit ?? ""}`.trim() : "",
            stage: { label: stage.label, tone: STAGE_TONE[stage.state] },
            supplyStatus: c.supplyStatus,
            supplier: c.supplier ?? "",
            orderedAt: toInputDate(c.orderedAt),
            expectedAt: toInputDate(c.expectedAt),
            receivedAt: toInputDate(c.receivedAt),
          };
        })}
      />

      {/* Görevler */}
      <section className="card overflow-x-auto">
        <div className="card-pad flex flex-wrap items-end justify-between gap-3 pb-3">
          <div>
            <h2 className="font-semibold">Görevler</h2>
            <p className="text-sm text-slate-500">Hangi parçanın hangi işlemde, kim tarafından, ne zaman yapılacağı</p>
          </div>
          {manage && tasks.length === 0 && (
            <ActionForm action={generatePlan} className="flex items-end gap-2">
              <input type="hidden" name="orderId" value={order.id} />
              <div>
                <label className="label">Plan başlangıcı</label>
                <input type="date" name="startDate" className="input" defaultValue={toInputDate(new Date())} />
              </div>
              <button className="btn-primary">Planı otomatik oluştur</button>
            </ActionForm>
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
                          <ActionForm id={formId} action={updateTask}>
                            <input type="hidden" name="taskId" value={t.id} />
                            <button className="btn btn-xs">Kaydet</button>
                          </ActionForm>
                          <ActionForm action={deleteTask}>
                            <input type="hidden" name="taskId" value={t.id} />
                            <button className="btn btn-xs text-red-600">Sil</button>
                          </ActionForm>
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
          <ActionForm action={createTask} className="card-pad grid gap-3 border-t border-slate-200 bg-slate-50/60 sm:grid-cols-2 lg:grid-cols-6">
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
          </ActionForm>
        )}
      </section>
    </>
  );
}
