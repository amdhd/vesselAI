-- DropForeignKey
ALTER TABLE "WorkOrder" DROP CONSTRAINT "WorkOrder_equipmentId_fkey";

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "equipmentName" TEXT NOT NULL,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'corrective',
ADD COLUMN     "vesselId" TEXT NOT NULL;

