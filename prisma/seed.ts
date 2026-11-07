import { PrismaClient, ComponentCategory as C, Role, OrgType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Yalnızca yerel geliştirme için demo şifresi. Canlı ortamda kullanmayın.
const DEMO_PASSWORD = "Demo1234!";

const HOODIE_COMPONENTS: {
  name: string;
  category: C;
  defaultSpec?: string;
  defaultUnit?: string;
  perUnitQty?: number;
  required?: boolean;
}[] = [
  { name: "Ana kumaş", category: C.FABRIC, defaultSpec: "3 iplik şardonlu, %80 pamuk %20 polyester, 320 gr/m²", defaultUnit: "kg", perUnitQty: 0.65 },
  { name: "Ribana (manşet & etek)", category: C.FABRIC, defaultSpec: "2x2 ribana, %95 pamuk %5 elastan", defaultUnit: "kg", perUnitQty: 0.08 },
  { name: "Kapüşon astarı", category: C.FABRIC, defaultSpec: "Süprem, 180 gr/m²", defaultUnit: "kg", perUnitQty: 0.1, required: false },
  { name: "Kordon", category: C.TRIM, defaultSpec: "Yassı kordon, 130 cm", defaultUnit: "adet", perUnitQty: 1 },
  { name: "Kordon ucu (metal uç)", category: C.TRIM, defaultSpec: "Metal, mat nikel", defaultUnit: "adet", perUnitQty: 2 },
  { name: "Kuşgözü", category: C.TRIM, defaultSpec: "10 mm metal halka", defaultUnit: "adet", perUnitQty: 2 },
  { name: "Fermuar", category: C.TRIM, defaultSpec: "No:5 spiral, ayrılabilir, 65 cm", defaultUnit: "adet", perUnitQty: 1, required: false },
  { name: "Dikiş ipliği", category: C.TRIM, defaultSpec: "Polyester core-spun, renk uyumlu", defaultUnit: "bobin" },
  { name: "Ön baskı", category: C.PRINT, defaultSpec: "Serigrafi, 2 renk, 25x30 cm", defaultUnit: "adet", perUnitQty: 1 },
  { name: "Sırt baskı", category: C.PRINT, defaultSpec: "Serigrafi, 1 renk, 30x40 cm", defaultUnit: "adet", perUnitQty: 1, required: false },
  { name: "Göğüs nakışı", category: C.EMBROIDERY, defaultSpec: "Logo nakışı, 8x8 cm", defaultUnit: "adet", perUnitQty: 1, required: false },
  { name: "Ana etiket (marka)", category: C.LABEL, defaultSpec: "Dokuma etiket", defaultUnit: "adet", perUnitQty: 1 },
  { name: "Beden etiketi", category: C.LABEL, defaultUnit: "adet", perUnitQty: 1 },
  { name: "Yıkama talimatı etiketi", category: C.LABEL, defaultSpec: "Saten baskılı", defaultUnit: "adet", perUnitQty: 1 },
  { name: "Asma etiket & barkod", category: C.LABEL, defaultUnit: "adet", perUnitQty: 1 },
  { name: "Polybag", category: C.PACKAGING, defaultSpec: "Yapışkan bantlı, uyarı yazılı", defaultUnit: "adet", perUnitQty: 1 },
  { name: "Koli", category: C.PACKAGING, defaultSpec: "5 katlı, 60x40x40", defaultUnit: "adet", perUnitQty: 0.04 },
];

const HOODIE_PROCESSES: { name: string; days: number; categories: C[] }[] = [
  { name: "Kumaş testi", days: 2, categories: [C.FABRIC] },
  { name: "Kalıp & pastal", days: 2, categories: [] },
  { name: "Kesim", days: 2, categories: [C.FABRIC] },
  { name: "Baskı", days: 3, categories: [C.PRINT] },
  { name: "Nakış", days: 2, categories: [C.EMBROIDERY] },
  { name: "Dikim", days: 5, categories: [] },
  { name: "Aksesuar & etiket uygulama", days: 1, categories: [] },
  { name: "Ütü", days: 1, categories: [] },
  { name: "Kalite kontrol", days: 1, categories: [] },
  { name: "Paketleme", days: 1, categories: [] },
  { name: "Sevkiyat", days: 1, categories: [] },
];

async function main() {
  // ── Ürün tipi: Hoodie
  const hoodie = await prisma.productType.upsert({
    where: { code: "HOODIE" },
    update: {},
    create: {
      code: "HOODIE",
      name: "Hoodie",
      description: "Kapüşonlu sweatshirt",
      components: {
        create: HOODIE_COMPONENTS.map((c, i) => ({ ...c, required: c.required ?? true, sortOrder: i })),
      },
      processes: {
        create: HOODIE_PROCESSES.map((p, i) => ({
          name: p.name,
          sortOrder: i,
          defaultDurationDays: p.days,
          componentCategories: p.categories,
        })),
      },
    },
  });

  // ── Demo verisi yalnızca `--demo` ile (npm run db:seed). Canlıda: npm run db:seed:prod
  if (!process.argv.includes("--demo")) {
    console.log("Ürün şablonları yüklendi (demo verisi atlandı).");
    return;
  }

  // ── Organizasyonlar
  const existing = await prisma.organization.findFirst({ where: { name: "Demo Tekstil A.Ş." } });
  if (existing) {
    console.log("Seed zaten uygulanmış, organizasyonlar atlandı.");
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const company = await prisma.organization.create({
    data: { name: "Demo Tekstil A.Ş.", type: OrgType.COMPANY },
  });
  const printShop = await prisma.organization.create({
    data: { name: "Renk Baskı Atölyesi", type: OrgType.SUBCOMPANY, parentId: company.id },
  });
  const sewingShop = await prisma.organization.create({
    data: { name: "Usta Dikim Atölyesi", type: OrgType.SUBCOMPANY, parentId: company.id },
  });
  const customer = await prisma.organization.create({
    data: { name: "Örnek Marka Ltd.", type: OrgType.CUSTOMER, parentId: company.id },
  });

  // ── Kullanıcılar (şifre: DEMO_PASSWORD)
  const users = [
    { email: "developer@erp.local", name: "Sistem Geliştirici", role: Role.DEVELOPER, organizationId: null },
    { email: "firma@erp.local", name: "Firma Yöneticisi", role: Role.COMPANY, organizationId: company.id },
    { email: "planlama@erp.local", name: "Planlama Sorumlusu", role: Role.COMPANY, organizationId: company.id },
    { email: "baski@erp.local", name: "Baskı Atölyesi", role: Role.SUBCOMPANY, organizationId: printShop.id },
    { email: "dikim@erp.local", name: "Dikim Atölyesi", role: Role.SUBCOMPANY, organizationId: sewingShop.id },
    { email: "musteri@erp.local", name: "Müşteri Temsilcisi", role: Role.CUSTOMER, organizationId: customer.id },
  ];
  for (const u of users) {
    await prisma.user.create({ data: { ...u, passwordHash } });
  }

  // ── Örnek sipariş
  const templates = await prisma.componentTemplate.findMany({
    where: { productTypeId: hoodie.id, required: true },
    orderBy: { sortOrder: "asc" },
  });
  const quantity = 500;
  await prisma.productionOrder.create({
    data: {
      code: "SP-2026-0001",
      modelName: "Basic Oversize Hoodie",
      productTypeId: hoodie.id,
      companyId: company.id,
      customerId: customer.id,
      quantity,
      color: "Antrasit",
      sizeBreakdown: { S: 100, M: 150, L: 150, XL: 100 },
      dueDate: new Date(Date.now() + 30 * 86400000),
      notes: "Örnek sipariş — seed ile oluşturuldu.",
      components: {
        create: templates.map((t, i) => ({
          templateId: t.id,
          name: t.name,
          category: t.category,
          spec: t.defaultSpec,
          unit: t.defaultUnit,
          quantity: t.perUnitQty ? Math.ceil(t.perUnitQty * quantity) : null,
          sortOrder: i,
        })),
      },
    },
  });

  console.log("Seed tamamlandı.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
