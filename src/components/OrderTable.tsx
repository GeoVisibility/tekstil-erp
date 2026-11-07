import Link from "next/link";
import type { OrderStatus, TaskStatus } from "@prisma/client";
import { Badge, Empty, ProgressBar } from "./ui";
import { ORDER_STATUS, formatDate } from "@/lib/labels";
import { currentStage, orderProgress } from "@/lib/progress";

export type OrderRow = {
  id: string;
  code: string;
  modelName: string;
  quantity: number;
  dueDate: Date | null;
  status: OrderStatus;
  productType: { name: string };
  customer: { name: string } | null;
  tasks: { status: TaskStatus; componentId: string | null; process: { id: string; name: string; sortOrder: number } }[];
};

export const orderRowInclude = {
  productType: { select: { name: true } },
  customer: { select: { name: true } },
  tasks: { select: { status: true, componentId: true, process: { select: { id: true, name: true, sortOrder: true } } } },
} as const;

export function OrderTable({ orders }: { orders: OrderRow[] }) {
  if (orders.length === 0) return <Empty>Henüz sipariş yok.</Empty>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[760px]">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className="th">Sipariş</th>
            <th className="th">Ürün</th>
            <th className="th">Müşteri</th>
            <th className="th text-right">Adet</th>
            <th className="th">Termin</th>
            <th className="th">Aşama</th>
            <th className="th w-44">İlerleme</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {orders.map((o) => {
            const stage = currentStage(o.tasks);
            const late = o.dueDate && o.status !== "COMPLETED" && new Date(o.dueDate) < new Date();
            return (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="td">
                  <Link href={`/orders/${o.id}`} className="font-medium text-indigo-700 hover:underline">
                    {o.code}
                  </Link>
                  <div className="text-xs text-slate-500">{o.modelName}</div>
                </td>
                <td className="td">{o.productType.name}</td>
                <td className="td">{o.customer?.name ?? "—"}</td>
                <td className="td text-right tabular-nums">{o.quantity.toLocaleString("tr-TR")}</td>
                <td className={`td whitespace-nowrap ${late ? "font-medium text-red-600" : ""}`}>{formatDate(o.dueDate)}</td>
                <td className="td">
                  <div className="flex flex-col items-start gap-1">
                    <Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge>
                    <span className="text-xs text-slate-500">
                      {stage === null ? "Plan yok" : stage === "DONE" ? "Tüm işlemler bitti" : stage.name}
                    </span>
                  </div>
                </td>
                <td className="td">
                  <ProgressBar value={orderProgress(o.tasks)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
