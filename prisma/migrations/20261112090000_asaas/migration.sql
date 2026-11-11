-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "asaas_customer_id" TEXT,
ADD COLUMN     "asaas_subscription_id" TEXT,
ADD COLUMN     "billing_type" TEXT,
ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "canceled_at" TIMESTAMP(3);
-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "asaas_payment_id" TEXT NOT NULL,
    "asaas_subscription_id" TEXT,
    "value" DECIMAL(10,2) NOT NULL,
    "net_value" DECIMAL(10,2),
    "status" TEXT NOT NULL,
    "billing_type" TEXT,
    "due_date" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "invoice_url" TEXT,
    "bank_slip_url" TEXT,
    "description" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "organization_id" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "payments_asaas_payment_id_key" ON "payments"("asaas_payment_id");
-- CreateIndex
CREATE INDEX "payments_organization_id_created_at_idx" ON "payments"("organization_id", "created_at");
-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");
-- CreateIndex
CREATE INDEX "webhook_deliveries_provider_created_at_idx" ON "webhook_deliveries"("provider", "created_at");
-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_provider_event_id_key" ON "webhook_deliveries"("provider", "event_id");
-- CreateIndex
CREATE INDEX "organizations_asaas_subscription_id_idx" ON "organizations"("asaas_subscription_id");
-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
