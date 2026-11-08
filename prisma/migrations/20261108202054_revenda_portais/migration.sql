-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "accepts_fgts" BOOLEAN,
ADD COLUMN     "accepts_financing" BOOLEAN,
ADD COLUMN     "building_floors" INTEGER,
ADD COLUMN     "commission_pct" DECIMAL(5,2),
ADD COLUMN     "complement" TEXT,
ADD COLUMN     "condo_fee" DECIMAL(15,2),
ADD COLUMN     "exclusive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "internal_notes" TEXT,
ADD COLUMN     "iptu_period" TEXT,
ADD COLUMN     "iptu_value" DECIMAL(15,2),
ADD COLUMN     "lot_area_m2" DECIMAL(10,2),
ADD COLUMN     "portal_address_display" TEXT NOT NULL DEFAULT 'street',
ADD COLUMN     "property_type" TEXT,
ADD COLUMN     "publish_to_portals" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "seller_lead_id" TEXT,
ADD COLUMN     "street_number" TEXT,
ADD COLUMN     "suites" INTEGER,
ADD COLUMN     "unit_floor" INTEGER,
ADD COLUMN     "year_built" INTEGER;

-- CreateIndex
CREATE INDEX "properties_organization_id_kind_publish_to_portals_idx" ON "properties"("organization_id", "kind", "publish_to_portals");

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_seller_lead_id_fkey" FOREIGN KEY ("seller_lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
