import Link from "next/link";
import { OrderTable, orderRowInclude } from "@/components/OrderTable";
import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { canManage } from "@/lib/roles";
import { orderScope } from "@/lib/scope";
import { requireSession } from "@/lib/session";

export default async function OrdersPage() {
  const s = await requireSession();
  const orders = await prisma.productionOrder.findMany({
    where: orderScope(s),
    include: orderRowInclude,
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <PageHeader
        title="Üretim Siparişleri"
        subtitle={`${orders.length} sipariş`}
        actions={canManage(s.role) && <Link href="/orders/new" className="btn-primary">+ Yeni sipariş</Link>}
      />
      <OrderTable orders={orders} />
    </>
  );
}
