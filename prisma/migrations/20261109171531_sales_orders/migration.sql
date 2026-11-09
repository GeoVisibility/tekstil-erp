-- CreateEnum
CREATE TYPE "SalesLineStatus" AS ENUM ('RECEIVED', 'IN_PRODUCTION', 'SHIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('EUR', 'USD', 'GBP', 'TRY');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "SizeSet" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "sizes" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SizeSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerOrderNo" TEXT,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'EUR',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderLine" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT NOT NULL,
    "color" TEXT,
    "fabric" TEXT,
    "sizeSetId" TEXT,
    "quantities" INTEGER[],
    "deliveryDate" TIMESTAMP(3),
    "unitPrice" DECIMAL(12,4),
    "status" "SalesLineStatus" NOT NULL DEFAULT 'RECEIVED',
    "notes" TEXT,
    "productionOrderId" TEXT,

    CONSTRAINT "SalesOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "rate" DECIMAL(12,4),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SizeSet_code_key" ON "SizeSet"("code");

-- CreateIndex
CREATE INDEX "SalesOrder_customerId_idx" ON "SalesOrder"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_companyId_code_key" ON "SalesOrder"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderLine_productionOrderId_key" ON "SalesOrderLine"("productionOrderId");

-- CreateIndex
CREATE INDEX "SalesOrderLine_salesOrderId_idx" ON "SalesOrderLine"("salesOrderId");

-- CreateIndex
CREATE INDEX "Shipment_lineId_idx" ON "Shipment"("lineId");

-- CreateIndex
CREATE INDEX "Payment_salesOrderId_idx" ON "Payment"("salesOrderId");

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_sizeSetId_fkey" FOREIGN KEY ("sizeSetId") REFERENCES "SizeSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "SalesOrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Excel'deki beden setleri (GRADE). Dizideki konum = Excel'deki beden sütunu (J..S).
INSERT INTO "SizeSet" ("id", "code", "name", "sizes", "sortOrder") VALUES
  ('sizeset_a', 'A', 'Harf (XXS–5XL)',        ARRAY['XXS','XS','S','M','L','XL','XXL','3XL','4XL','5XL'], 1),
  ('sizeset_b', 'B', 'Numara 8–18',           ARRAY['','8','10','12','14','16','18','','',''], 2),
  ('sizeset_c', 'C', 'Numara 16–28',          ARRAY['','','','16','18','20','22','24','26','28'], 3),
  ('sizeset_d', 'D', 'Büyük beden XL–10XL',   ARRAY['XL','XXL','3XL','4XL','5XL','6XL','7XL','8XL','9XL','10XL'], 4),
  ('sizeset_e', 'E', 'Çocuk yaş 2-3 – 7-8',   ARRAY['2-3','3-4','4-5','5-6','6-7','7-8','','','',''], 5),
  ('sizeset_f', 'F', 'Numara 32–50',          ARRAY['32','34','36','38','40','42','44','46','48','50'], 6),
  ('sizeset_g', 'G', 'Çocuk 4–18',            ARRAY['4','6','8','10','12','14','16','18','',''], 7)
ON CONFLICT ("code") DO NOTHING;
