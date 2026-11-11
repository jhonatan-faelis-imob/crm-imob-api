-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "billing_document" TEXT,
ADD COLUMN     "billing_email" TEXT,
ADD COLUMN     "billing_name" TEXT,
ADD COLUMN     "billing_phone" TEXT,
ADD COLUMN     "current_period_end" TIMESTAMP(3),
ADD COLUMN     "monthly_price" DECIMAL(10,2),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "seats" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "subscription_status" TEXT NOT NULL DEFAULT 'ativa',
ADD COLUMN     "trial_ends_at" TIMESTAMP(3);
-- CreateTable
CREATE TABLE "billing_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "data" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "billing_events_organization_id_created_at_idx" ON "billing_events"("organization_id", "created_at");
-- CreateIndex
CREATE INDEX "organizations_subscription_status_idx" ON "organizations"("subscription_status");
-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
