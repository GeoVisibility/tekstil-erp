"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ComponentCategory } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/session";

const CATEGORIES: ComponentCategory[] = ["FABRIC", "TRIM", "PRINT", "EMBROIDERY", "LABEL", "PACKAGING"];

function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
function num(fd: FormData, key: string) {
  const v = str(fd, key);
  if (v === null) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function category(fd: FormData, key = "category"): ComponentCategory {
  const v = str(fd, key) as ComponentCategory | null;
  return v && CATEGORIES.includes(v) ? v : "TRIM";
}
function categories(fd: FormData) {
  return fd.getAll("cat").filter((c): c is ComponentCategory => CATEGORIES.includes(c as ComponentCategory));
}
function fail(productId: string, msg: string): never {
  redirect(`/products/${productId}?error=${encodeURIComponent(msg)}`);
}
function done(productId: string) {
  revalidatePath(`/products/${productId}`);
  revalidatePath("/products");
}

const auth = () => requireRole("DEVELOPER", "COMPANY");

// ─── Ürün tipi ─────────────────────────────────────────────────

const productSchema = z.object({
  name: z.string().trim().min(2),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,20}$/),
  description: z.string().trim().optional(),
  copyFrom: z.string().optional(),
});

export async function createProduct(formData: FormData) {
  await auth();
  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    redirect(`/products?error=${encodeURIComponent("Ad en az 2 karakter, kod 2-20 karakter (A-Z, 0-9, - _) olmalı.")}`);
  }
  const d = parsed.data;
  if (await prisma.productType.findUnique({ where: { code: d.code } })) {
    redirect(`/products?error=${encodeURIComponent(`"${d.code}" kodu zaten kullanılıyor.`)}`);
  }

  // İsteğe bağlı: mevcut bir üründen parça ve işlemleri kopyala
  const source = d.copyFrom
    ? await prisma.productType.findUnique({ where: { id: d.copyFrom }, include: { components: true, processes: true } })
    : null;

  const product = await prisma.productType.create({
    data: {
      name: d.name,
      code: d.code,
      description: d.description || null,
      components: source
        ? {
            create: source.components.map(({ name, category, defaultSpec, defaultUnit, perUnitQty, required, sortOrder }) => ({
              name, category, defaultSpec, defaultUnit, perUnitQty, required, sortOrder,
            })),
          }
        : undefined,
      processes: source
        ? {
            create: source.processes.map(({ name, sortOrder, defaultDurationDays, componentCategories }) => ({
              name, sortOrder, defaultDurationDays, componentCategories,
            })),
          }
        : undefined,
    },
  });
  revalidatePath("/products");
  redirect(`/products/${product.id}`);
}

export async function updateProduct(formData: FormData) {
  await auth();
  const id = String(formData.get("productId"));
  const name = str(formData, "name");
  if (!name || name.length < 2) fail(id, "Ürün adı en az 2 karakter olmalı.");
  await prisma.productType.update({
    where: { id },
    data: { name, description: str(formData, "description"), active: formData.get("active") === "on" },
  });
  done(id);
}

// ─── Parça şablonları ──────────────────────────────────────────

function componentData(fd: FormData) {
  return {
    name: str(fd, "name"),
    category: category(fd),
    defaultSpec: str(fd, "defaultSpec"),
    defaultUnit: str(fd, "defaultUnit"),
    perUnitQty: num(fd, "perUnitQty"),
    required: fd.get("required") === "on",
  };
}

export async function addComponent(formData: FormData) {
  await auth();
  const productTypeId = String(formData.get("productId"));
  const data = componentData(formData);
  if (!data.name) fail(productTypeId, "Parça adı gerekli.");
  const max = await prisma.componentTemplate.aggregate({ where: { productTypeId }, _max: { sortOrder: true } });
  await prisma.componentTemplate.create({
    data: { ...data, name: data.name, productTypeId, sortOrder: (max._max.sortOrder ?? -1) + 1 },
  });
  done(productTypeId);
}

export async function updateComponentTemplate(formData: FormData) {
  await auth();
  const comp = await prisma.componentTemplate.findUniqueOrThrow({ where: { id: String(formData.get("id")) } });
  const data = componentData(formData);
  if (!data.name) fail(comp.productTypeId, "Parça adı boş olamaz.");
  await prisma.componentTemplate.update({ where: { id: comp.id }, data: { ...data, name: data.name } });
  done(comp.productTypeId);
}

/** Şablon silinir; eski siparişlerdeki parça kayıtları (kopya oldukları için) korunur. */
export async function deleteComponentTemplate(formData: FormData) {
  await auth();
  const comp = await prisma.componentTemplate.findUniqueOrThrow({ where: { id: String(formData.get("id")) } });
  await prisma.componentTemplate.delete({ where: { id: comp.id } });
  done(comp.productTypeId);
}

// ─── İşlem şablonları ──────────────────────────────────────────

export async function addProcess(formData: FormData) {
  await auth();
  const productTypeId = String(formData.get("productId"));
  const name = str(formData, "name");
  if (!name) fail(productTypeId, "İşlem adı gerekli.");
  const max = await prisma.processTemplate.aggregate({ where: { productTypeId }, _max: { sortOrder: true } });
  await prisma.processTemplate.create({
    data: {
      productTypeId,
      name,
      defaultDurationDays: Math.max(1, Math.round(num(formData, "days") ?? 1)),
      componentCategories: categories(formData),
      sortOrder: (max._max.sortOrder ?? -1) + 1,
    },
  });
  done(productTypeId);
}

export async function updateProcess(formData: FormData) {
  await auth();
  const proc = await prisma.processTemplate.findUniqueOrThrow({ where: { id: String(formData.get("id")) } });
  const name = str(formData, "name");
  if (!name) fail(proc.productTypeId, "İşlem adı boş olamaz.");
  await prisma.processTemplate.update({
    where: { id: proc.id },
    data: {
      name,
      defaultDurationDays: Math.max(1, Math.round(num(formData, "days") ?? 1)),
      componentCategories: categories(formData),
    },
  });
  done(proc.productTypeId);
}

/** Görevlerde kullanılan işlem silinemez (üretim geçmişi bozulmasın). */
export async function deleteProcess(formData: FormData) {
  await auth();
  const proc = await prisma.processTemplate.findUniqueOrThrow({
    where: { id: String(formData.get("id")) },
    include: { _count: { select: { tasks: true } } },
  });
  if (proc._count.tasks > 0) {
    fail(proc.productTypeId, `"${proc.name}" işlemi ${proc._count.tasks} görevde kullanılıyor, silinemez.`);
  }
  await prisma.processTemplate.delete({ where: { id: proc.id } });
  done(proc.productTypeId);
}

// ─── Sıralama ──────────────────────────────────────────────────

/** Bir öğeyi listede bir üst/alt sıradaki ile yer değiştirir. */
export async function move(formData: FormData) {
  await auth();
  const kind = formData.get("kind") === "process" ? "process" : "component";
  const id = String(formData.get("id"));
  const dir = formData.get("dir") === "up" ? "up" : "down";

  const select = { id: true, productTypeId: true } as const;
  const orderBy = [{ sortOrder: "asc" as const }, { id: "asc" as const }];
  const item =
    kind === "process"
      ? await prisma.processTemplate.findUniqueOrThrow({ where: { id }, select })
      : await prisma.componentTemplate.findUniqueOrThrow({ where: { id }, select });
  const where = { productTypeId: item.productTypeId };
  const siblings =
    kind === "process"
      ? await prisma.processTemplate.findMany({ where, orderBy, select })
      : await prisma.componentTemplate.findMany({ where, orderBy, select });
  const idx = siblings.findIndex((s) => s.id === id);
  const swapIdx = dir === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) return;

  // Sıra numaralarını 0..n olarak yeniden yaz (eşit sortOrder'lar da düzelir)
  const ordered = [...siblings];
  [ordered[idx], ordered[swapIdx]] = [ordered[swapIdx], ordered[idx]];
  await prisma.$transaction(
    ordered.map((s, i) =>
      kind === "process"
        ? prisma.processTemplate.update({ where: { id: s.id }, data: { sortOrder: i } })
        : prisma.componentTemplate.update({ where: { id: s.id }, data: { sortOrder: i } }),
    ),
  );
  done(item.productTypeId);
}
