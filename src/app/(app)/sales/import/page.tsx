import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ImportWizard } from "./ImportWizard";

export default async function SalesImportPage() {
  const s = await requireRole("DEVELOPER", "COMPANY");
  const companies =
    s.role === "DEVELOPER"
      ? await prisma.organization.findMany({ where: { type: "COMPANY", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : null;

  return (
    <>
      <PageHeader
        title="Excel'den Sipariş Aktar"
        subtitle="Mevcut sipariş tablonuzu yükleyin, eşleştirmeleri kontrol edin ve onaylayın."
        actions={<Link href="/sales" className="btn">← Sipariş listesi</Link>}
      />
      <ImportWizard companies={companies} />
    </>
  );
}
