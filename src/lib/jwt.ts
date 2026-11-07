// Edge uyumlu (middleware'de de kullanılır) — Prisma import ETMEYİN.
import { SignJWT, jwtVerify } from "jose";
import type { Role } from "./roles";

export const SESSION_COOKIE = "erp_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 saat

export type SessionPayload = {
  uid: string;
  name: string;
  role: Role;
  orgId: string | null;
};

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET tanımlı değil");
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}
