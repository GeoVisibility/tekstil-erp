import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySession, type SessionPayload } from "./jwt";
import type { Role } from "./roles";

export async function createSession(payload: SessionPayload) {
  const token = await signSession(payload);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSession() {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}

/** Oturum yoksa login'e yönlendirir. */
export async function requireSession() {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** Sunucu tarafında (server action dahil) rol kontrolü. */
export async function requireRole(...roles: Role[]) {
  const s = await requireSession();
  if (!roles.includes(s.role)) throw new Error("Bu işlem için yetkiniz yok.");
  return s;
}
