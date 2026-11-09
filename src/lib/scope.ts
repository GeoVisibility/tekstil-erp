import type { Prisma } from "@prisma/client";
import type { SessionPayload } from "./jwt";

const NONE = { id: "__none__" };

/** Kullanıcının görebileceği siparişler. Tüm sipariş sorguları bundan geçmeli. */
export function orderScope(s: SessionPayload): Prisma.ProductionOrderWhereInput {
  switch (s.role) {
    case "DEVELOPER":
      return {};
    case "COMPANY":
      return s.orgId ? { companyId: s.orgId } : NONE;
    case "SUBCOMPANY":
      return s.orgId
        ? { tasks: { some: { OR: [{ assigneeOrgId: s.orgId }, { assigneeUserId: s.uid }] } } }
        : NONE;
    case "CUSTOMER":
      return s.orgId ? { customerId: s.orgId } : NONE;
  }
}

/** Kullanıcının görebileceği görevler. */
export function taskScope(s: SessionPayload): Prisma.TaskWhereInput {
  switch (s.role) {
    case "DEVELOPER":
      return {};
    case "COMPANY":
      return s.orgId ? { order: { companyId: s.orgId } } : NONE;
    case "SUBCOMPANY":
      return { OR: [{ assigneeOrgId: s.orgId ?? "__none__" }, { assigneeUserId: s.uid }] };
    case "CUSTOMER":
      return s.orgId ? { order: { customerId: s.orgId } } : NONE;
  }
}

/** Firmanın yönetebileceği organizasyonlar (kendisi + bağlı alt firma/müşteriler). */
export function orgScope(s: SessionPayload): Prisma.OrganizationWhereInput {
  if (s.role === "DEVELOPER") return {};
  if (s.role === "COMPANY" && s.orgId) return { OR: [{ id: s.orgId }, { parentId: s.orgId }] };
  return NONE;
}

/** Kullanıcının görebileceği satış siparişleri (sipariş listesi). */
export function salesScope(s: SessionPayload): Prisma.SalesOrderWhereInput {
  if (s.role === "DEVELOPER") return {};
  if (s.role === "COMPANY" && s.orgId) return { companyId: s.orgId };
  return NONE;
}
