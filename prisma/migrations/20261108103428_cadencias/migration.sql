-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "auto_generated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cadence_stage_id" TEXT,
ADD COLUMN     "cadence_step_id" TEXT;

-- CreateTable
CREATE TABLE "stage_cadence_steps" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "funnel_stage_id" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'ligacao',
    "priority" TEXT NOT NULL DEFAULT 'media',
    "offset_days" INTEGER NOT NULL,
    "due_time" TEXT NOT NULL DEFAULT '09:00',
    "skip_weekends" BOOLEAN NOT NULL DEFAULT false,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stage_cadence_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stage_cadence_steps_organization_id_funnel_stage_id_idx" ON "stage_cadence_steps"("organization_id", "funnel_stage_id");

-- CreateIndex
CREATE INDEX "tasks_lead_id_cadence_stage_id_idx" ON "tasks"("lead_id", "cadence_stage_id");

-- AddForeignKey
ALTER TABLE "stage_cadence_steps" ADD CONSTRAINT "stage_cadence_steps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_cadence_steps" ADD CONSTRAINT "stage_cadence_steps_funnel_stage_id_fkey" FOREIGN KEY ("funnel_stage_id") REFERENCES "funnel_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
