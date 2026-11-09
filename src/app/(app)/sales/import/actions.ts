"use server";

import { revalidatePath } from "next/cache";
import { SalesLineStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseDateInput, today } from "@/lib/labels";
import { parseOrderWorkbook, type ImportRow } from "@/lib/salesImport";
import { requireRole } from "@/lib/session";

export type ImportPreview = {
  error?: string;
  sheetName?: string;
  rows?: ImportRow[];
  warnings?: string[];
  statusCodes?: { code: string; count: number; suggested: SalesLineStatus }[];
  clients?: { name: string; count: number; matchId: string | null }[];
  existingCodes?: string[];
  customers?: { id: string; name: string }[];
  companyId?: string;
};

const normName = (v: string) => v.trim().replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");

/** Excel kodu için tahmini durum (kullanıcı ekranda değiştirebilir). */
function suggestStatus(code: string): SalesLineStatus {
  const c = code.trim().toLocaleUpperCase("tr-TR");
  if (c === "Y") return "SHIPPED";
  if (c === "Ü" || c === "U") return "IN_PRODUCTION";
  if (c === "İ" || c === "I") return "RECEIVED";
  return "RECEIVED";
}

async function companyFor(s: Awaited<ReturnType<typeof requireRole>>, input?: string | null) {
  const companyId = s.role === "COMPANY" ? s.orgId : input;
  if (!companyId) throw new Error("Firma seçilmeli.");
  const c = await prisma.organization.findFirst({ where: { id: companyId, type: "COMPANY" } });
  if (!c) throw new Error("Firma bulunamadı.");
  return c.id;
}

/** 1. adım: dosyayı okur, eşleştirme önerileriyle önizleme döndürür. Veritabanına yazmaz. */
export async function previewImport(_: ImportPreview, fd: FormData): Promise<ImportPreview> {
  try {
    const s = await requireRole("DEVELOPER", "COMPANY");
    const companyId = await companyFor(s, fd.get("companyId") as string | null);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Bir Excel dosyası seçin." };
    if (!/\.xlsx$/i.test(file.name)) return { error: "Yalnızca .xlsx dosyaları destekleniyor (Excel'de 'Farklı kaydet → .xlsx')." };
    if (file.size > 4 * 1024 * 1024) return { error: "Dosya 4 MB'tan büyük olamaz." };

    const { rows, warnings, sheetName } = await parseOrderWorkbook(await file.arrayBuffer());
    if (rows.length === 0) return { error: "Dosyada aktarılacak satır bulunamadı." };

    const customers = await prisma.organization.findMany({
      where: { type: "CUSTOMER", parentId: companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const byName = new Map(customers.map((c) => [normName(c.name), c.id]));

    const statusMap = new Map<string, number>();
    const clientMap = new Map<string, { name: string; count: number }>();
    for (const r of rows) {
      statusMap.set(r.statusCode, (statusMap.get(r.statusCode) ?? 0) + 1);
      const k = normName(r.client);
      const prev = clientMap.get(k);
      clientMap.set(k, { name: prev?.name ?? r.client.trim(), count: (prev?.count ?? 0) + 1 });
    }

    const codes = [...new Set(rows.map((r) => r.code))];
    const existing = await prisma.salesOrder.findMany({ where: { companyId, code: { in: codes } }, select: { code: true } });

    const missingDates = rows.filter((r) => !r.orderDate).length;
    if (missingDates) warnings.push(`${missingDates} satırda sipariş tarihi yok; bugünün tarihi kullanılacak.`);
    const unknownGrades = [...new Set(rows.map((r) => r.grade).filter(Boolean))];
    const sets = await prisma.sizeSet.findMany({ where: { code: { in: unknownGrades } }, select: { code: true } });
    const missingSets = unknownGrades.filter((g) => !sets.some((x) => x.code === g));
    if (missingSets.length) warnings.push(`Tanımsız beden seti: ${missingSets.join(", ")}. Bu satırlar setsiz aktarılır.`);

    return {
      sheetName,
      rows,
      warnings,
      companyId,
      customers,
      existingCodes: existing.map((e) => e.code),
      statusCodes: [...statusMap].map(([code, count]) => ({ code, count, suggested: suggestStatus(code) })),
      clients: [...clientMap.values()].map((c) => ({ ...c, matchId: byName.get(normName(c.name)) ?? null })),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Dosya okunamadı." };
  }
}

export type CommitInput = {
  companyId: string;
  rows: ImportRow[];
  statusMap: Record<string, SalesLineStatus>;
  /** Excel'deki müşteri adı → mevcut müşteri id'si veya "new" */
  clientMap: Record<string, string>;
  importPayments: boolean;
};

export type CommitResult = { error?: string; created?: number; lines?: number; skipped?: string[]; newCustomers?: number; payments?: number };

/** 2. adım: onaylanan eşleştirmelerle siparişleri oluşturur. Var olan sipariş kodları atlanır. */
export async function commitImport(input: CommitInput): Promise<CommitResult> {
  try {
    const s = await requireRole("DEVELOPER", "COMPANY");
    const companyId = await companyFor(s, input.companyId);
    const rows = input.rows;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 5000) return { error: "Aktarılacak satır yok." };
    const validStatus = new Set(Object.values(SalesLineStatus));

    // Müşteriler: eşleşenleri doğrula, yenileri oluştur
    const customerIdByName = new Map<string, string>();
    let newCustomers = 0;
    for (const [name, target] of Object.entries(input.clientMap)) {
      const key = normName(name);
      if (target === "new") {
        const found = await prisma.organization.findFirst({
          where: { type: "CUSTOMER", parentId: companyId, name: { equals: name.trim(), mode: "insensitive" } },
        });
        const org = found ?? (await prisma.organization.create({ data: { name: name.trim(), type: "CUSTOMER", parentId: companyId } }));
        if (!found) newCustomers++;
        customerIdByName.set(key, org.id);
      } else {
        const org = await prisma.organization.findFirst({ where: { id: target, type: "CUSTOMER", parentId: companyId } });
        if (!org) return { error: `"${name}" için seçilen müşteri geçersiz.` };
        customerIdByName.set(key, org.id);
      }
    }

    const sizeSets = await prisma.sizeSet.findMany({ select: { id: true, code: true } });
    const setId = new Map(sizeSets.map((x) => [x.code, x.id]));
    const existing = new Set(
      (await prisma.salesOrder.findMany({ where: { companyId }, select: { code: true } })).map((o) => o.code),
    );

    // Satırları sipariş koduna göre grupla
    const groups = new Map<string, ImportRow[]>();
    for (const r of rows) {
      const g = groups.get(r.code) ?? [];
      g.push(r);
      groups.set(r.code, g);
    }

    const skipped: string[] = [];
    let created = 0;
    let lineCount = 0;
    let paymentCount = 0;
    const fallbackDate = today();

    for (const [code, group] of groups) {
      if (existing.has(code)) {
        skipped.push(code);
        continue;
      }
      const first = group[0];
      const customerId = customerIdByName.get(normName(first.client));
      if (!customerId) return { error: `"${first.client}" müşterisi eşleştirilmedi.` };
      const orderDate = first.orderDate ? parseDateInput(first.orderDate) : fallbackDate;
      const received = group.reduce((a, r) => a + (r.received ?? 0), 0);
      const rate = group.find((r) => r.rate != null)?.rate ?? null;

      await prisma.salesOrder.create({
        data: {
          code,
          companyId,
          customerId,
          customerOrderNo: first.customerOrderNo || null,
          orderDate,
          currency: first.currency,
          notes: "Excel'den aktarıldı.",
          createdById: s.uid,
          lines: {
            create: group.map((r, i) => {
              const status = input.statusMap[r.statusCode];
              const shipDate = r.shipDate || r.deliveryDate || first.orderDate;
              return {
                sortOrder: i,
                model: r.model,
                color: r.color || null,
                fabric: r.fabric || null,
                sizeSetId: setId.get(r.grade) ?? null,
                quantities: r.quantities.slice(0, 10).map((q) => Math.max(0, Math.round(Number(q) || 0))),
                deliveryDate: r.deliveryDate ? parseDateInput(r.deliveryDate) : null,
                unitPrice: r.unitPrice,
                status: validStatus.has(status) ? status : "RECEIVED",
                shipments:
                  r.shipped > 0
                    ? { create: [{ date: shipDate ? parseDateInput(shipDate) : orderDate, quantity: r.shipped, note: "Excel'den aktarıldı" }] }
                    : undefined,
              };
            }),
          },
          payments:
            input.importPayments && received > 0
              ? {
                  create: [
                    {
                      date: orderDate,
                      amount: Math.round(received * 100) / 100,
                      currency: first.currency,
                      rate: first.currency === "TRY" ? 1 : rate,
                      note: "Excel'den aktarıldı (ALINAN BEDEL)",
                    },
                  ],
                }
              : undefined,
        },
      });
      created++;
      lineCount += group.length;
      if (input.importPayments && received > 0) paymentCount++;
    }

    revalidatePath("/sales");
    revalidatePath("/admin/organizations");
    return { created, lines: lineCount, skipped, newCustomers, payments: paymentCount };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Aktarım sırasında hata oluştu." };
  }
}
