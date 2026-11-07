-- AlterTable
ALTER TABLE "OrderComponent" ADD COLUMN     "expectedAt" TIMESTAMP(3),
ADD COLUMN     "orderedAt" TIMESTAMP(3),
ADD COLUMN     "receivedAt" TIMESTAMP(3);
