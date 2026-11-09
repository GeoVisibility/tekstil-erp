import "server-only";
import { prisma } from "./db";

/** Üretim siparişi kodu: SP-2026-0001 */
export async function nextOrderCode() {
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

export const SALES_CODE_PREFIX = "MHS";

/** Firmanın bir sonraki sipariş kodu: MHS001, MHS002 ... (en büyük numaranın bir fazlası) */
export async function nextSalesCode(companyId: string) {
  const codes = await prisma.salesOrder.findMany({
    where: { companyId, code: { startsWith: SALES_CODE_PREFIX } },
    select: { code: true },
  });
  const max = codes.reduce((m, { code }) => {
    const n = parseInt(code.slice(SALES_CODE_PREFIX.length), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return SALES_CODE_PREFIX + String(max + 1).padStart(3, "0");
}
