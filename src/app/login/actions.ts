"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSession, destroySession } from "@/lib/session";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

export type LoginState = { error?: string };

export async function login(_: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "E-posta ve şifre gerekli." };

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email }, include: { organization: { select: { active: true } } } });
  const ok = user && user.active && (user.organization?.active ?? true) && (await bcrypt.compare(parsed.data.password, user.passwordHash));
  if (!ok) return { error: "E-posta veya şifre hatalı." };

  await createSession({ uid: user.id, name: user.name, role: user.role, orgId: user.organizationId });

  const next = parsed.data.next;
  redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
