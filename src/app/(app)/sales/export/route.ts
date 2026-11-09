import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { LINE_STATUS, SIZE_SLOTS } from "@/lib/sales";
import { querySalesLines } from "@/lib/salesQuery";
import { getSession } from "@/lib/session";
import { salesScope } from "@/lib/scope";

/** Sipariş listesini, Mutlu Bey'in Excel düzenine benzer biçimde .xlsx olarak indirir. */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s || (s.role !== "DEVELOPER" && s.role !== "COMPANY")) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const f = Object.fromEntries(["q", "customer", "status", "from", "to"].map((k) => [k, sp.get(k) ?? undefined]));
  const { rows } = await querySalesLines(s, f);
  const sizeSets = await prisma.sizeSet.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Tekstil Üretim Takip";
  const ws = wb.addWorksheet("Genel Sipariş", { views: [{ state: "frozen", ySplit: sizeSets.length + 2, xSplit: 6 }] });

  // Üstte beden seti açıklaması (Excel'deki GRADE tablosu gibi)
  sizeSets.forEach((set, r) => {
    const row = ws.getRow(r + 1);
    row.getCell(9).value = set.code;
    set.sizes.forEach((label, i) => {
      if (label) row.getCell(10 + i).value = label;
    });
    row.font = { size: 9, color: { argb: "FF64748B" } };
  });

  const headerRowNo = sizeSets.length + 2;
  const sizeHeader = sizeSets.find((x) => x.code === "A")?.sizes ?? Array.from({ length: SIZE_SLOTS }, (_, i) => `B${i + 1}`);
  const header = [
    "S", "OR.DATE", "SİP KOD.", "CLIENT", "ORDER", "MODEL", "COLOUR", "FABRIC", "GRADE",
    ...Array.from({ length: SIZE_SLOTS }, (_, i) => sizeHeader[i] || `B${i + 1}`),
    "TOPLAM", "DATE", "PRICE", "YÜKLENEN", "DÖVİZ", "TOTAL", "Y. TUTAR", "SHIP. DATE", "ÜRETİM",
  ];
  const hr = ws.getRow(headerRowNo);
  hr.values = header;
  hr.font = { bold: true };
  hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };

  for (const r of rows) {
    const so = r.salesOrder;
    ws.addRow([
      LINE_STATUS[r.status].short,
      so.orderDate,
      so.code,
      so.customer.name,
      so.customerOrderNo ?? "",
      r.model,
      r.color ?? "",
      r.fabric ?? "",
      r.sizeSet?.code ?? "",
      ...Array.from({ length: SIZE_SLOTS }, (_, i) => r.quantities[i] || null),
      r.totals.qty,
      r.deliveryDate,
      r.unitPrice,
      r.totals.shippedQty || null,
      so.currency,
      r.totals.amount,
      r.totals.shippedQty ? r.totals.shippedAmount : null,
      r.shipments[0]?.date ?? null,
      r.productionOrder?.code ?? "",
    ]);
  }

  const dateCols = [2, 21, 27];
  for (const c of dateCols) ws.getColumn(c).numFmt = "dd.mm.yyyy";
  for (const c of [22, 25, 26]) ws.getColumn(c).numFmt = "#,##0.00";
  ws.columns.forEach((col, i) => {
    col.width = [4, 11, 10, 18, 12, 26, 14, 36, 6][i] ?? (i < 19 ? 6 : 12);
  });
  ws.autoFilter = { from: { row: headerRowNo, column: 1 }, to: { row: headerRowNo, column: header.length } };

  // Tahsilatlar ayrı sayfada
  const orderIds = [...new Set(rows.map((r) => r.salesOrder.id))];
  const payments = await prisma.payment.findMany({
    where: { salesOrderId: { in: orderIds }, salesOrder: salesScope(s) },
    include: { salesOrder: { select: { code: true, customer: { select: { name: true } } } } },
    orderBy: { date: "asc" },
  });
  const ps = wb.addWorksheet("Tahsilatlar");
  ps.addRow(["TARİH", "SİP KOD.", "CLIENT", "TUTAR", "DÖVİZ", "KUR", "TL KARŞILIĞI", "NOT"]).font = { bold: true };
  for (const p of payments) {
    const amount = Number(p.amount);
    const rate = p.rate != null ? Number(p.rate) : null;
    ps.addRow([p.date, p.salesOrder.code, p.salesOrder.customer.name, amount, p.currency, rate, rate != null ? amount * rate : null, p.note ?? ""]);
  }
  ps.getColumn(1).numFmt = "dd.mm.yyyy";
  ps.getColumn(4).numFmt = "#,##0.00";
  ps.getColumn(7).numFmt = "#,##0.00";
  ps.columns.forEach((c, i) => (c.width = [12, 10, 22, 12, 7, 9, 14, 30][i]));

  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="siparis-listesi-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
