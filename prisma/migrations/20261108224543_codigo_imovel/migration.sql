-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "property_code_seq" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "properties_organization_id_code_key" ON "properties"("organization_id", "code");

