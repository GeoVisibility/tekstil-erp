import Link from "next/link";
import { SalesOrderCreateForm } from "@/components/sales/SalesForms";
import { PageHeader } from "@/components/ui";
import { nextSalesCode } from "@/lib/codes";
import { prisma } from "@/lib/db";
import { toInputDate, today } from "@/lib/labels";
import { requireRole } from "@/lib/session";

export default async function NewSalesOrderPage() {
  const s = await requireRole("DEVELOPER", "COMPANY");

  const [customers, companies, sizeSets] = await Promise.all([
    prisma.organization.findMany({
      where: { type: "CUSTOMER", active: true, ...(s.role === "COMPANY" ? { parentId: s.orgId ?? "__none__" } : {}) },
      select: { id: true, name: true, parentId: true },
      orderBy: { name: "asc" },
    }),
    s.role === "DEVELOPER"
      ? prisma.organization.findMany({ where: { type: "COMPANY", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : null,
    prisma.sizeSet.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const companyId = s.role === "COMPANY" ? s.orgId : companies?.[0]?.id;
  const defaultCode = companyId ? await nextSalesCode(companyId) : "MHS001";

  return (
    <>
      <PageHeader
        title="Yeni Sipariş"
        subtitle={
          customers.length === 0 ? (
            <span className="text-amber-700">
              Henüz müşteri yok. Önce <Link href="/admin/organizations" className="underline">Firmalar</Link> ekranından müşteri ekleyin.
            </span>
          ) : (
            "Sipariş bilgilerini ve satırları girin; tek seferde kaydedilir."
          )
        }
        actions={<Link href="/sales" className="btn">← Sipariş listesi</Link>}
      />
      <SalesOrderCreateForm
        defaultCode={defaultCode}
        customers={customers.map((c) => ({ id: c.id, name: c.name, companyId: c.parentId }))}
        companies={companies}
        sizeSets={sizeSets.map((x) => ({ id: x.id, code: x.code, name: x.name, sizes: x.sizes }))}
        today={toInputDate(today())}
      />
    </>
  );
}
