"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { OrgType, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ORG_TYPE_LABELS } from "@/lib/labels";
import { withFormState, type FormState } from "@/lib/form";
import { requireRole } from "@/lib/session";
import { orgUsage, userUsage } from "@/lib/usage";

const orgSchema = z.object({
  // Fazla boşluklar tek boşluğa indirilir ("VLAYN  " ile "VLAYN" aynı sayılır)
  name: z.string().transform((v) => v.replace(/\s+/g, " ").trim()).pipe(z.string().min(2, "Ad en az 2 karakter olmalı.")),
  type: z.enum(["COMPANY", "SUBCOMPANY", "CUSTOMER", "SUPPLIER"], "Geçersiz organizasyon tipi."),
  parentId: z.string().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
});

/** Ad karşılaştırma anahtarı: boşluklar, büyük/küçük harf ve i/ı/İ/I farkı yok sayılır. */
const orgNameKey = (v: string) => v.replace(/\s+/g, " ").trim().toLocaleUpperCase("tr-TR").replace(/İ/g, "I");

/** Aynı firmaya bağlı, aynı tipte ve aynı adda ikinci kaydı engeller (pasif kayıtlar dahil). */
async function assertUniqueOrgName(name: string, type: OrgType, parentId: string | null, excludeId?: string) {
  // Türkçe harfler (Ş/ş, Ç/ç, İ/i) veritabanı harmanlamasına bırakılmadan burada karşılaştırılır
  const siblings = await prisma.organization.findMany({
    where: { type, parentId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { name: true, active: true },
  });
  const key = orgNameKey(name);
  const dup = siblings.find((o) => orgNameKey(o.name) === key);
  if (dup) {
    throw new Error(
      `"${dup.name}" adında bir ${ORG_TYPE_LABELS[type].toLocaleLowerCase("tr-TR")} zaten kayıtlı${dup.active ? "" : " (pasif durumda)"}. Mevcut kaydı kullanın.`,
    );
  }
}

async function createOrganizationImpl(formData: FormData) {
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
    if (!parent) throw new Error("Alt firma, müşteri ve tedarikçiler bir firmaya bağlı olmalı.");
  }

  await assertUniqueOrgName(d.name, type, parentId);
  await prisma.organization.create({
    data: { name: d.name, type, parentId, phone: d.phone || null, email: d.email || null },
  });
  revalidatePath("/admin/organizations");
}

const userSchema = z.object({
  name: z.string().trim().min(2, "Ad soyad en az 2 karakter olmalı."),
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin."),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı."),
  organizationId: z.string().optional(),
  role: z.enum(["DEVELOPER", "COMPANY", "SUBCOMPANY", "CUSTOMER"]).optional(),
});

/** Kullanıcının rolü bağlı olduğu organizasyonun tipinden türetilir. Tedarikçilerin kullanıcısı olmaz. */
function roleForOrg(type: OrgType): Role {
  if (type === "SUPPLIER") throw new Error("Tedarikçilere kullanıcı bağlanamaz.");
  return type;
}

async function createUserImpl(formData: FormData) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const d = userSchema.parse(Object.fromEntries(formData));

  let role: Role;
  let organizationId: string | null = d.organizationId || null;

  if (d.role === "DEVELOPER") {
    if (s.role !== "DEVELOPER") throw new Error("Yetkiniz yok.");
    role = "DEVELOPER";
    organizationId = null;
  } else {
    if (!organizationId) {
      throw new Error("Organizasyon seçilmeli. Henüz yoksa önce Firmalar ekranından bir firma ekleyin.");
    }
    const org = await prisma.organization.findFirst({
      where: {
        id: organizationId,
        ...(s.role === "COMPANY" ? { OR: [{ id: s.orgId ?? "__none__" }, { parentId: s.orgId ?? "__none__" }] } : {}),
      },
    });
    if (!org) throw new Error("Geçersiz organizasyon.");
    // Rol, kullanıcının bağlı olduğu organizasyon tipinden türetilir
    role = roleForOrg(org.type);
  }

  const exists = await prisma.user.findUnique({ where: { email: d.email } });
  if (exists) throw new Error("Bu e-posta zaten kayıtlı.");

  await prisma.user.create({
    data: { name: d.name, email: d.email, passwordHash: await bcrypt.hash(d.password, 10), role, organizationId },
  });
  revalidatePath("/admin/users");
}

async function toggleUserActiveImpl(formData: FormData) {
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

// ─── Organizasyon düzenleme / silme ────────────────────────────

/** Oturumun yönetebileceği organizasyonu getirir (firma: kendisi + bağlıları). */
async function manageableOrg(s: Awaited<ReturnType<typeof requireRole>>, id: string) {
  const org = await prisma.organization.findFirst({
    where: {
      id,
      ...(s.role === "COMPANY" ? { OR: [{ id: s.orgId ?? "__none__" }, { parentId: s.orgId ?? "__none__" }] } : {}),
    },
  });
  if (!org) throw new Error("Organizasyon bulunamadı.");
  return org;
}


const orgUpdateSchema = orgSchema.extend({ id: z.string().min(1) });

async function updateOrganizationImpl(formData: FormData) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const d = orgUpdateSchema.parse(Object.fromEntries(formData));
  const org = await manageableOrg(s, d.id);

  let type: OrgType = org.type;
  let parentId = org.parentId;

  if (s.role === "COMPANY") {
    // Firma kendi tipini değiştiremez; bağlılarını alt firma ↔ müşteri arasında değiştirebilir
    if (org.id !== s.orgId) {
      if (d.type === "COMPANY") throw new Error("Bağlı kayıt Firma tipine çevrilemez.");
      type = d.type;
    }
  } else {
    type = d.type;
    if (type === "COMPANY") parentId = null;
    else {
      const parent = d.parentId ? await prisma.organization.findFirst({ where: { id: d.parentId, type: "COMPANY" } }) : null;
      if (!parent) throw new Error("Alt firma, müşteri ve tedarikçiler bir firmaya bağlı olmalı.");
      if (parent.id === org.id) throw new Error("Kayıt kendisine bağlanamaz.");
      parentId = parent.id;
    }
    if (org.type === "COMPANY" && type !== "COMPANY") {
      const children = await prisma.organization.count({ where: { parentId: org.id } });
      if (children) throw new Error("Bağlı kayıtları olan firmanın tipi değiştirilemez.");
    }
  }

  if (type === "SUPPLIER" && type !== org.type) {
    const users = await prisma.user.count({ where: { organizationId: org.id } });
    if (users) throw new Error("Kullanıcısı olan kayıt tedarikçiye çevrilemez. Önce kullanıcıları silin veya başka kayda taşıyın.");
  }
  await assertUniqueOrgName(d.name, type, parentId, org.id);

  await prisma.$transaction([
    prisma.organization.update({
      where: { id: org.id },
      data: { name: d.name, type, parentId, phone: d.phone || null, email: d.email || null },
    }),
    // Tip değiştiyse kullanıcıların rolü de yeni tipe uyar
    ...(type !== org.type
      ? [prisma.user.updateMany({ where: { organizationId: org.id, role: { not: "DEVELOPER" } }, data: { role: roleForOrg(type) } })]
      : []),
  ]);
  revalidatePath("/admin/organizations");
  revalidatePath(`/admin/organizations/${org.id}`);
}

async function toggleOrgActiveImpl(formData: FormData) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const org = await manageableOrg(s, String(formData.get("id")));
  if (org.id === s.orgId) throw new Error("Kendi firmanızı pasif yapamazsınız.");
  await prisma.organization.update({ where: { id: org.id }, data: { active: !org.active } });
  revalidatePath("/admin/organizations");
  revalidatePath(`/admin/organizations/${org.id}`);
}

async function deleteOrganizationImpl(formData: FormData) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const org = await manageableOrg(s, String(formData.get("id")));
  if (org.id === s.orgId) throw new Error("Kendi firmanızı silemezsiniz.");
  const usage = await orgUsage(org.id);
  if (usage.length) {
    throw new Error(`Silinemez: ${usage.join(", ")} bağlı. Bunun yerine pasif yapabilirsiniz.`);
  }
  await prisma.organization.delete({ where: { id: org.id } });
  revalidatePath("/admin/organizations");
  redirect("/admin/organizations");
}

// ─── Kullanıcı düzenleme / silme ───────────────────────────────

async function manageableUser(s: Awaited<ReturnType<typeof requireRole>>, id: string) {
  const user = await prisma.user.findFirst({
    where: {
      id,
      ...(s.role === "COMPANY"
        ? { organization: { OR: [{ id: s.orgId ?? "__none__" }, { parentId: s.orgId ?? "__none__" }] } }
        : {}),
    },
  });
  if (!user) throw new Error("Kullanıcı bulunamadı.");
  return user;
}


const userUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(2, "Ad soyad en az 2 karakter olmalı."),
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta girin."),
  organizationId: z.string().optional(),
  password: z
    .string()
    .optional()
    .refine((v) => !v || v.length >= 8, "Yeni şifre en az 8 karakter olmalı."),
});

async function updateUserImpl(formData: FormData) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const d = userUpdateSchema.parse(Object.fromEntries(formData));
  const user = await manageableUser(s, d.id);

  const dup = await prisma.user.findFirst({ where: { email: d.email, id: { not: user.id } } });
  if (dup) throw new Error("Bu e-posta başka bir kullanıcıda kayıtlı.");

  let role = user.role;
  let organizationId = user.organizationId;
  if (user.role !== "DEVELOPER" && d.organizationId && d.organizationId !== user.organizationId) {
    if (user.id === s.uid) throw new Error("Kendi organizasyonunuzu değiştiremezsiniz.");
    const org = await manageableOrg(s, d.organizationId);
    organizationId = org.id;
    role = roleForOrg(org.type);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: d.name,
      email: d.email,
      organizationId,
      role,
      ...(d.password ? { passwordHash: await bcrypt.hash(d.password, 10) } : {}),
    },
  });
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${user.id}`);
}

async function deleteUserImpl(formData: FormData) {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const user = await manageableUser(s, String(formData.get("id")));
  if (user.id === s.uid) throw new Error("Kendi hesabınızı silemezsiniz.");
  const usage = await userUsage(user.id);
  if (usage.length) {
    throw new Error(`Silinemez: ${usage.join(", ")} bu kullanıcıya bağlı. Bunun yerine pasif yapabilirsiniz.`);
  }
  await prisma.user.delete({ where: { id: user.id } });
  revalidatePath("/admin/users");
  redirect("/admin/users");
}

// ─── Form'lara açılan action'lar (hatalar sayfayı çökertmez, uyarı olarak döner) ───

export async function updateOrganization(_: FormState, formData: FormData) {
  return withFormState(() => updateOrganizationImpl(formData));
}
export async function toggleOrgActive(_: FormState, formData: FormData) {
  return withFormState(() => toggleOrgActiveImpl(formData));
}
export async function deleteOrganization(_: FormState, formData: FormData) {
  return withFormState(() => deleteOrganizationImpl(formData));
}
export async function updateUser(_: FormState, formData: FormData) {
  return withFormState(() => updateUserImpl(formData));
}
export async function deleteUser(_: FormState, formData: FormData) {
  return withFormState(() => deleteUserImpl(formData));
}

export async function createOrganization(_: FormState, formData: FormData) {
  return withFormState(() => createOrganizationImpl(formData));
}
export async function createUser(_: FormState, formData: FormData) {
  return withFormState(() => createUserImpl(formData));
}
export async function toggleUserActive(_: FormState, formData: FormData) {
  return withFormState(() => toggleUserActiveImpl(formData));
}
