"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ComponentCategory, Prisma, SupplyStatus, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withFormState, type FormState } from "@/lib/form";
import { parseDateInput, today } from "@/lib/labels";
import { syncOrderStatus } from "@/lib/progress";
import { orderScope, taskScope } from "@/lib/scope";
import { requireRole, requireSession } from "@/lib/session";
import type { SessionPayload } from "@/lib/jwt";

const DAY = 86400000;

function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
function date(fd: FormData, key: string) {
  const v = str(fd, key);
  return v ? parseDateInput(v) : null;
}

/** Yönetilebilir siparişi getirir; kapsam dışıysa hata verir. */
async function manageableOrder(s: SessionPayload, orderId: string) {
  const order = await prisma.productionOrder.findFirst({ where: { id: orderId, ...orderScope(s) } });
  if (!order) throw new Error("Sipariş bulunamadı veya erişim yok.");
  return order;
}

/** Atanan kullanıcı/organizasyon, siparişin firmasına bağlı olmalı. */
async function validateAssignees(companyId: string, userId: string | null, orgId: string | null) {
  if (orgId) {
    const org = await prisma.organization.findFirst({ where: { id: orgId, OR: [{ id: companyId }, { parentId: companyId }] } });
    if (!org) throw new Error("Geçersiz alt firma.");
  }
  if (userId) {
    const user = await prisma.user.findFirst({
      where: { id: userId, organization: { OR: [{ id: companyId }, { parentId: companyId }] } },
    });
    if (!user) throw new Error("Geçersiz kullanıcı.");
  }
}

async function nextOrderCode() {
  const year = new Date().getFullYear();
  const prefix = `SP-${year}-`;
  const last = await prisma.productionOrder.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  const n = last ? parseInt(last.code.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(4, "0");
}

// ─── Sipariş oluşturma ─────────────────────────────────────────

const orderSchema = z.object({
  productTypeId: z.string().min(1),
  modelName: z.string().trim().min(1, "Model adı gerekli"),
  quantity: z.coerce.number().int().positive("Adet pozitif olmalı"),
  color: z.string().trim().optional(),
  customerId: z.string().optional(),
  companyId: z.string().optional(),
  dueDate: z.string().optional(),
  notes: z.string().trim().optional(),
});

const SIZES = ["XS", "S", "M", "L", "XL", "XXL"];
const CATEGORIES: ComponentCategory[] = ["FABRIC", "TRIM", "PRINT", "EMBROIDERY", "LABEL", "PACKAGING"];

async function createOrderImpl(formData: FormData) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const data = orderSchema.parse(Object.fromEntries(formData));

  // Firma kullanıcısı her zaman kendi firması adına açar; developer firma seçer.
  const companyId = s.role === "COMPANY" ? s.orgId : data.companyId;
  if (!companyId) throw new Error("Firma seçilmeli.");

  const customerId = data.customerId || null;
  if (customerId) {
    const c = await prisma.organization.findFirst({ where: { id: customerId, parentId: companyId, type: "CUSTOMER" } });
    if (!c) throw new Error("Müşteri bu firmaya bağlı değil.");
  }

  const product = await prisma.productType.findUniqueOrThrow({
    where: { id: data.productTypeId },
    include: { components: { orderBy: { sortOrder: "asc" } } },
  });

  const sizeBreakdown: Record<string, number> = {};
  for (const size of SIZES) {
    const n = Number(formData.get(`size_${size}`) || 0);
    if (n > 0) sizeBreakdown[size] = n;
  }

  // Seçilen parçalar ve detayları
  const components: Prisma.OrderComponentCreateWithoutOrderInput[] = product.components
    .filter((t) => formData.get(`comp_${t.id}_on`) === "on")
    .map((t, i) => {
      const qty = str(formData, `comp_${t.id}_qty`);
      return {
        template: { connect: { id: t.id } },
        name: t.name,
        category: t.category,
        spec: str(formData, `comp_${t.id}_spec`),
        color: str(formData, `comp_${t.id}_color`),
        supplier: str(formData, `comp_${t.id}_supplier`),
        quantity: qty
          ? Number(qty.replace(",", "."))
          : t.perUnitQty
            ? Math.ceil(t.perUnitQty * data.quantity * 100) / 100
            : null,
        unit: t.defaultUnit,
        sortOrder: i,
      };
    });

  // Ek (şablonda olmayan) parçalar
  for (let i = 0; i < 5; i++) {
    const name = str(formData, `extra_${i}_name`);
    if (!name) continue;
    const category = str(formData, `extra_${i}_category`) as ComponentCategory | null;
    components.push({
      name,
      category: category && CATEGORIES.includes(category) ? category : "TRIM",
      spec: str(formData, `extra_${i}_spec`),
      sortOrder: components.length,
    });
  }

  const order = await prisma.productionOrder.create({
    data: {
      code: await nextOrderCode(),
      modelName: data.modelName,
      productTypeId: product.id,
      companyId,
      customerId,
      quantity: data.quantity,
      color: data.color || null,
      sizeBreakdown: Object.keys(sizeBreakdown).length ? sizeBreakdown : undefined,
      dueDate: data.dueDate ? parseDateInput(data.dueDate) : null,
      notes: data.notes || null,
      createdById: s.uid,
      components: { create: components },
    },
  });

  revalidatePath("/orders");
  redirect(`/orders/${order.id}`);
}

// ─── Plan & görevler ───────────────────────────────────────────

/** Ürünün işlem şablonlarından görevleri otomatik oluşturur (sıralı tarihlerle). */
async function generatePlanImpl(formData: FormData) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const order = await manageableOrder(s, String(formData.get("orderId")));

  const existing = await prisma.task.count({ where: { orderId: order.id } });
  if (existing > 0) throw new Error("Bu siparişin zaten görevleri var.");

  const [processes, components] = await Promise.all([
    prisma.processTemplate.findMany({ where: { productTypeId: order.productTypeId }, orderBy: { sortOrder: "asc" } }),
    prisma.orderComponent.findMany({ where: { orderId: order.id }, orderBy: { sortOrder: "asc" } }),
  ]);

  const start = date(formData, "startDate") ?? today();
  let cursor = start.getTime();
  const tasks: {
    orderId: string;
    processId: string;
    componentId: string | null;
    startDate: Date;
    dueDate: Date;
  }[] = [];

  for (const p of processes) {
    const targets = p.componentCategories.length
      ? components.filter((c) => p.componentCategories.includes(c.category))
      : [null];
    if (targets.length === 0) continue; // örn. siparişte nakış yoksa Nakış adımı atlanır
    const startDate = new Date(cursor);
    const dueDate = new Date(cursor + (p.defaultDurationDays - 1) * DAY);
    for (const c of targets) {
      tasks.push({ orderId: order.id, processId: p.id, componentId: c?.id ?? null, startDate, dueDate });
    }
    cursor += p.defaultDurationDays * DAY;
  }

  await prisma.task.createMany({ data: tasks });
  await syncOrderStatus(order.id);
  revalidatePath(`/orders/${order.id}`);
}

async function createTaskImpl(formData: FormData) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const order = await manageableOrder(s, String(formData.get("orderId")));

  const processId = str(formData, "processId");
  if (!processId) throw new Error("İşlem seçilmeli.");
  const process = await prisma.processTemplate.findFirst({ where: { id: processId, productTypeId: order.productTypeId } });
  if (!process) throw new Error("Geçersiz işlem.");

  const componentId = str(formData, "componentId");
  if (componentId) {
    const c = await prisma.orderComponent.findFirst({ where: { id: componentId, orderId: order.id } });
    if (!c) throw new Error("Geçersiz parça.");
  }

  const assigneeUserId = str(formData, "assigneeUserId");
  const assigneeOrgId = str(formData, "assigneeOrgId");
  await validateAssignees(order.companyId, assigneeUserId, assigneeOrgId);

  await prisma.task.create({
    data: {
      orderId: order.id,
      processId,
      componentId,
      assigneeUserId,
      assigneeOrgId,
      startDate: date(formData, "startDate"),
      dueDate: date(formData, "dueDate"),
      note: str(formData, "note"),
    },
  });
  await syncOrderStatus(order.id);
  revalidatePath(`/orders/${order.id}`);
}

/** Firma: görevin atamasını ve tarihlerini günceller. */
async function updateTaskImpl(formData: FormData) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const task = await prisma.task.findFirst({
    where: { id: String(formData.get("taskId")), ...taskScope(s) },
    include: { order: true },
  });
  if (!task) throw new Error("Görev bulunamadı.");

  const assigneeUserId = str(formData, "assigneeUserId");
  const assigneeOrgId = str(formData, "assigneeOrgId");
  await validateAssignees(task.order.companyId, assigneeUserId, assigneeOrgId);

  await prisma.task.update({
    where: { id: task.id },
    data: {
      assigneeUserId,
      assigneeOrgId,
      startDate: date(formData, "startDate"),
      dueDate: date(formData, "dueDate"),
    },
  });
  revalidatePath(`/orders/${task.orderId}`);
}

const STATUSES: TaskStatus[] = ["PENDING", "IN_PROGRESS", "DONE", "BLOCKED"];

/** Görev durumunu değiştirir. Firma tüm görevleri, alt firma yalnızca kendine atananları. */
async function setTaskStatusImpl(formData: FormData) {
  const s = await requireSession();
  if (s.role === "CUSTOMER") throw new Error("Yetkiniz yok.");

  const status = String(formData.get("status")) as TaskStatus;
  if (!STATUSES.includes(status)) throw new Error("Geçersiz durum.");

  const task = await prisma.task.findFirst({ where: { id: String(formData.get("taskId")), ...taskScope(s) } });
  if (!task) throw new Error("Görev bulunamadı.");

  await prisma.task.update({
    where: { id: task.id },
    data: {
      status,
      startedAt: status === "IN_PROGRESS" && !task.startedAt ? new Date() : task.startedAt,
      completedAt: status === "DONE" ? new Date() : null,
    },
  });
  await syncOrderStatus(task.orderId);
  revalidatePath(`/orders/${task.orderId}`);
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
}

async function deleteTaskImpl(formData: FormData) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const task = await prisma.task.findFirst({ where: { id: String(formData.get("taskId")), ...taskScope(s) } });
  if (!task) throw new Error("Görev bulunamadı.");
  await prisma.task.delete({ where: { id: task.id } });
  await syncOrderStatus(task.orderId);
  revalidatePath(`/orders/${task.orderId}`);
}

// ─── Parça (malzeme) güncelleme ────────────────────────────────

const isoDate = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Geçersiz tarih.")
  .transform((v) => (v ? parseDateInput(v) : null));

const componentRowSchema = z.object({
  id: z.string().min(1),
  supplyStatus: z.enum(["PENDING", "ORDERED", "IN_STOCK"] satisfies SupplyStatus[], "Geçersiz tedarik durumu."),
  supplier: z
    .string()
    .trim()
    .max(120, "Tedarikçi adı çok uzun.")
    .transform((v) => v || null),
  orderedAt: isoDate,
  expectedAt: isoDate,
  receivedAt: isoDate,
});

export type ComponentRowInput = z.input<typeof componentRowSchema>;

/** Parça tablosundaki tüm değişiklikleri tek seferde kaydeder. */
export async function saveComponents(orderId: string, rows: ComponentRowInput[]): Promise<FormState> {
  return withFormState(async () => {
    const s = await requireRole("DEVELOPER", "COMPANY");
    const order = await manageableOrder(s, orderId);
    if (order.status === "CANCELLED") throw new Error("İptal edilmiş sipariş düzenlenemez.");

    const parsed = z.array(componentRowSchema).max(200).parse(rows);
    if (parsed.length === 0) return;

    // Tüm satırlar bu siparişe ait olmalı
    const owned = await prisma.orderComponent.count({ where: { orderId: order.id, id: { in: parsed.map((r) => r.id) } } });
    if (owned !== parsed.length) throw new Error("Bazı parçalar bu siparişe ait değil.");

    for (const r of parsed) {
      if (r.receivedAt && r.orderedAt && r.receivedAt < r.orderedAt) {
        throw new Error("Geliş tarihi, sipariş tarihinden önce olamaz.");
      }
    }

    await prisma.$transaction(
      parsed.map(({ id, ...data }) => prisma.orderComponent.update({ where: { id }, data })),
    );
    revalidatePath(`/orders/${order.id}`);
  });
}

async function cancelOrderImpl(formData: FormData) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const order = await manageableOrder(s, String(formData.get("orderId")));
  await prisma.productionOrder.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
  revalidatePath(`/orders/${order.id}`);
  revalidatePath("/orders");
}

// ─── Form'lara açılan action'lar (hatalar sayfayı çökertmez, uyarı olarak döner) ───

export async function createOrder(_: FormState, formData: FormData) {
  return withFormState(() => createOrderImpl(formData));
}
export async function generatePlan(_: FormState, formData: FormData) {
  return withFormState(() => generatePlanImpl(formData));
}
export async function createTask(_: FormState, formData: FormData) {
  return withFormState(() => createTaskImpl(formData));
}
export async function updateTask(_: FormState, formData: FormData) {
  return withFormState(() => updateTaskImpl(formData));
}
export async function setTaskStatus(_: FormState, formData: FormData) {
  return withFormState(() => setTaskStatusImpl(formData));
}
export async function deleteTask(_: FormState, formData: FormData) {
  return withFormState(() => deleteTaskImpl(formData));
}
export async function cancelOrder(_: FormState, formData: FormData) {
  return withFormState(() => cancelOrderImpl(formData));
}
