-- CreateTable
CREATE TABLE "property_shares" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "created_by" TEXT,
    "token" TEXT NOT NULL,
    "show_price" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "first_viewed_at" TIMESTAMP(3),
    "last_viewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "property_shares_token_key" ON "property_shares"("token");

-- CreateIndex
CREATE INDEX "property_shares_property_id_idx" ON "property_shares"("property_id");

-- CreateIndex
CREATE INDEX "property_shares_lead_id_idx" ON "property_shares"("lead_id");

-- CreateIndex
CREATE INDEX "property_shares_organization_id_created_by_idx" ON "property_shares"("organization_id", "created_by");

-- AddForeignKey
ALTER TABLE "property_shares" ADD CONSTRAINT "property_shares_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_shares" ADD CONSTRAINT "property_shares_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_shares" ADD CONSTRAINT "property_shares_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
