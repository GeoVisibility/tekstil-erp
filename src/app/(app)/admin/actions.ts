"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { OrgType, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/session";

const orgSchema = z.object({
  name: z.string().trim().min(2),
  type: z.enum(["COMPANY", "SUBCOMPANY", "CUSTOMER"]),
  parentId: z.string().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
});

export async function createOrganization(formData: FormData) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const d = orgSchema.parse(Object.fromEntries(formData));

  const type: OrgType = d.type;
  let parentId: string | null = d.parentId || null;

  if (s.role === "COMPANY") {
    // Firma yalnızca kendine bağlı alt firma / müşteri açabilir
    if (type === "COMPANY") throw new Error("Firma yalnızca alt firma veya müşteri ekleyebilir.");
    parentId = s.orgId;
  } else if (type === "COMPANY") {
    parentId = null;
  } else {
    const parent = parentId ? await prisma.organization.findFirst({ where: { id: parentId, type: "COMPANY" } }) : null;
    if (!parent) throw new Error("Alt firma ve müşteriler bir firmaya bağlı olmalı.");
  }

  await prisma.organization.create({
    data: { name: d.name, type, parentId, phone: d.phone || null, email: d.email || null },
  });
  revalidatePath("/admin/organizations");
}

const userSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı"),
  organizationId: z.string().optional(),
  role: z.enum(["DEVELOPER", "COMPANY", "SUBCOMPANY", "CUSTOMER"]).optional(),
});

const ROLE_FOR_ORG: Record<OrgType, Role> = { COMPANY: "COMPANY", SUBCOMPANY: "SUBCOMPANY", CUSTOMER: "CUSTOMER" };

export async function createUser(formData: FormData) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const d = userSchema.parse(Object.fromEntries(formData));

  let role: Role;
  let organizationId: string | null = d.organizationId || null;

  if (d.role === "DEVELOPER") {
    if (s.role !== "DEVELOPER") throw new Error("Yetkiniz yok.");
    role = "DEVELOPER";
    organizationId = null;
  } else {
    if (!organizationId) throw new Error("Organizasyon seçilmeli.");
    const org = await prisma.organization.findFirst({
      where: {
        id: organizationId,
        ...(s.role === "COMPANY" ? { OR: [{ id: s.orgId ?? "__none__" }, { parentId: s.orgId ?? "__none__" }] } : {}),
      },
    });
    if (!org) throw new Error("Geçersiz organizasyon.");
    // Rol, kullanıcının bağlı olduğu organizasyon tipinden türetilir
    role = ROLE_FOR_ORG[org.type];
  }

  const exists = await prisma.user.findUnique({ where: { email: d.email } });
  if (exists) throw new Error("Bu e-posta zaten kayıtlı.");

  await prisma.user.create({
    data: { name: d.name, email: d.email, passwordHash: await bcrypt.hash(d.password, 10), role, organizationId },
  });
  revalidatePath("/admin/users");
}

export async function toggleUserActive(formData: FormData) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const id = String(formData.get("userId"));
  if (id === s.uid) throw new Error("Kendi hesabınızı pasif yapamazsınız.");
  const user = await prisma.user.findFirst({
    where: {
      id,
      ...(s.role === "COMPANY"
        ? { organization: { OR: [{ id: s.orgId ?? "__none__" }, { parentId: s.orgId ?? "__none__" }] } }
        : {}),
    },
  });
  if (!user) throw new Error("Kullanıcı bulunamadı.");
  await prisma.user.update({ where: { id }, data: { active: !user.active } });
  revalidatePath("/admin/users");
}
