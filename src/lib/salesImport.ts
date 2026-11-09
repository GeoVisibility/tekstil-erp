import "server-only";
import ExcelJS from "exceljs";
import type { Currency } from "@prisma/client";
import { SIZE_SLOTS } from "./sales";

/** Excel'den okunan bir sipariş satırı (henüz veritabanına yazılmamış). */
export type ImportRow = {
  rowNo: number;
  statusCode: string;
  orderDate: string; // YYYY-MM-DD
  code: string;
  client: string;
  customerOrderNo: string;
  model: string;
  color: string;
  fabric: string;
  grade: string;
  quantities: number[];
  deliveryDate: string;
  unitPrice: number | null;
  shipped: number;
  currency: Currency;
  shipDate: string;
  rate: number | null;
  received: number | null; // ALINAN BEDEL
};

export type ParseResult = { rows: ImportRow[]; warnings: string[]; sheetName: string };

const norm = (v: string) =>
  v
    .toLocaleUpperCase("tr-TR")
    .replace(/[İI]/g, "I")
    .replace(/Ş/g, "S")
    .replace(/Ç/g, "C")
    .replace(/Ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/Ö/g, "O")
    .replace(/[^A-Z0-9]/g, "");

/** Hücre değeri: formül sonucu, zengin metin ve tarihleri düz değere çevirir. */
function raw(cell: ExcelJS.Cell): unknown {
  const v = cell.value as unknown;
  if (v && typeof v === "object") {
    if (v instanceof Date) return v;
    if ("result" in v) return (v as { result: unknown }).result ?? null;
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
    if ("text" in v) return (v as { text: string }).text;
    if ("error" in v) return null;
  }
  return v ?? null;
}
const text = (c: ExcelJS.Cell) => {
  const v = raw(c);
  return v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim();
};
const number = (c: ExcelJS.Cell) => {
  const v = raw(c);
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const date = (c: ExcelJS.Cell) => {
  const v = raw(c);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // Excel seri tarih
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  return "";
};

function currencyOf(v: string): Currency | null {
  const n = norm(v);
  if (!n) return null;
  if (["EURO", "EUR", "AVRO"].includes(n) || v.includes("€")) return "EUR";
  if (["USD", "DOLAR", "DOLLAR", "US"].includes(n) || v.includes("$")) return "USD";
  if (["GBP", "STERLIN", "POUND"].includes(n) || v.includes("£")) return "GBP";
  if (["TL", "TRY", "TURKLIRASI"].includes(n) || v.includes("₺")) return "TRY";
  return null;
}

// Başlık adı → alan. Başlıklar normalize edilerek (büyük harf, işaretsiz) eşleştirilir.
const HEADERS: Record<string, string[]> = {
  status: ["S", "DURUM"],
  orderDate: ["ORDATE", "ORDERDATE", "SIPARISTARIHI"],
  code: ["SIPKOD", "SIPARISKODU", "SIPKODU"],
  client: ["CLIENT", "MUSTERI"],
  customerOrderNo: ["ORDER", "ORDERNO"],
  model: ["MODEL"],
  color: ["COLOUR", "COLOR", "RENK"],
  fabric: ["FABRIC", "KUMAS"],
  grade: ["GRADE", "SET", "BEDENSETI"],
  total: ["TOPLAM", "QTY"],
  deliveryDate: ["DATE", "DELIVERY", "TERMIN"],
  price: ["PRICE", "FIYAT"],
  shipped: ["YUKLENEN", "SHIPPED"],
  currency: ["DOVIZ", "CURRENCY"],
  shipDate: ["SHIPDATE", "SEVKTARIHI"],
  rate: ["KUR"],
  received: ["ALINANBEDEL"],
};

/** Mutlu Bey'in "Genel Sipariş" Excel düzenini okur. */
export async function parseOrderWorkbook(buf: ArrayBuffer): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const warnings: string[] = [];

  // Başlık satırını bul: GRADE ve MODEL sütunları olan ilk satır
  for (const ws of wb.worksheets) {
    let headerRow = 0;
    const col: Record<string, number> = {};
    ws.eachRow({ includeEmpty: false }, (row, rowNo) => {
      if (headerRow) return;
      const names = new Map<string, number>();
      row.eachCell((c, colNo) => {
        const n = norm(text(c));
        if (n && !names.has(n)) names.set(n, colNo);
      });
      if (names.has("MODEL") && (names.has("GRADE") || names.has("CLIENT"))) {
        headerRow = rowNo;
        for (const [field, alts] of Object.entries(HEADERS)) {
          const hit = alts.find((a) => names.has(a));
          if (hit) col[field] = names.get(hit)!;
        }
      }
    });
    if (!headerRow) continue;

    for (const req of ["code", "client", "model"]) {
      if (!col[req]) throw new Error(`"${req === "code" ? "SİP KOD." : req === "client" ? "CLIENT" : "MODEL"}" sütunu bulunamadı.`);
    }
    // Beden sütunları: GRADE'den sonraki 10 sütun (yoksa TOPLAM'dan önceki 10 sütun)
    const sizeStart = col.grade ? col.grade + 1 : col.total ? col.total - SIZE_SLOTS : 0;
    if (!sizeStart) throw new Error("Beden sütunları bulunamadı (GRADE veya TOPLAM başlığı gerekli).");

    const rows: ImportRow[] = [];
    let lastCurrency: Currency = "EUR";
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (f: string) => (col[f] ? row.getCell(col[f]) : null);
      const code = get("code") ? text(get("code")!) : "";
      const model = get("model") ? text(get("model")!) : "";
      if (!code && !model) continue; // boş satır
      if (!code || !model) {
        warnings.push(`Satır ${r}: sipariş kodu veya model boş, atlandı.`);
        continue;
      }
      const quantities = Array.from({ length: SIZE_SLOTS }, (_, i) => Math.max(0, Math.round(number(row.getCell(sizeStart + i)) ?? 0)));
      const qty = quantities.reduce((a, b) => a + b, 0);
      const total = get("total") ? number(get("total")!) : null;
      if (total != null && qty === 0 && total > 0) {
        warnings.push(`Satır ${r}: beden adetleri yok, toplam (${total}) ilk bedene yazıldı. Kontrol edin.`);
        quantities[0] = Math.round(total);
      } else if (total != null && Math.round(total) !== qty) {
        warnings.push(`Satır ${r}: TOPLAM (${total}) beden adetlerinin toplamıyla (${qty}) uyuşmuyor; beden adetleri kullanıldı.`);
      }
      const curText = get("currency") ? text(get("currency")!) : "";
      const currency: Currency = currencyOf(curText) ?? lastCurrency;
      if (curText && !currencyOf(curText)) warnings.push(`Satır ${r}: döviz "${curText}" tanınmadı, ${currency} kabul edildi.`);
      lastCurrency = currency;

      rows.push({
        rowNo: r,
        statusCode: get("status") ? text(get("status")!) : "",
        orderDate: get("orderDate") ? date(get("orderDate")!) : "",
        code,
        client: get("client") ? text(get("client")!) : "",
        customerOrderNo: get("customerOrderNo") ? text(get("customerOrderNo")!) : "",
        model,
        color: get("color") ? text(get("color")!) : "",
        fabric: get("fabric") ? text(get("fabric")!) : "",
        grade: get("grade") ? text(get("grade")!).toUpperCase() : "",
        quantities,
        deliveryDate: get("deliveryDate") ? date(get("deliveryDate")!) : "",
        unitPrice: get("price") ? number(get("price")!) : null,
        shipped: Math.max(0, Math.round((get("shipped") ? number(get("shipped")!) : 0) ?? 0)),
        currency,
        shipDate: get("shipDate") ? date(get("shipDate")!) : "",
        rate: get("rate") ? number(get("rate")!) : null,
        received: get("received") ? number(get("received")!) : null,
      });
    }
    return { rows, warnings, sheetName: ws.name };
  }
  throw new Error("Başlık satırı bulunamadı. Tabloda MODEL ve GRADE (veya CLIENT) başlıkları olmalı.");
}
