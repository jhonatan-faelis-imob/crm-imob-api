-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "terms_accepted_at" TIMESTAMP(3),
ADD COLUMN     "terms_accepted_by" TEXT,
ADD COLUMN     "terms_version" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deactivated_at" TIMESTAMP(3),
ADD COLUMN     "deactivated_by" TEXT,
ADD COLUMN     "deactivation_reason" TEXT;
