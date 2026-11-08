-- CreateTable
CREATE TABLE "document_requirements" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'pessoal',
    "holder" TEXT NOT NULL DEFAULT 'titular',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "applies_when" TEXT NOT NULL DEFAULT 'always',
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_checklist_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "requirement_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendente',
    "notes" TEXT,
    "received_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "updated_by" TEXT,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_requirements_organization_id_active_idx" ON "document_requirements"("organization_id", "active");

-- CreateIndex
CREATE INDEX "lead_checklist_items_organization_id_lead_id_idx" ON "lead_checklist_items"("organization_id", "lead_id");

-- CreateIndex
CREATE INDEX "lead_checklist_items_lead_id_status_idx" ON "lead_checklist_items"("lead_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lead_checklist_items_lead_id_requirement_id_holder_key" ON "lead_checklist_items"("lead_id", "requirement_id", "holder");

-- AddForeignKey
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_checklist_items" ADD CONSTRAINT "lead_checklist_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_checklist_items" ADD CONSTRAINT "lead_checklist_items_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
