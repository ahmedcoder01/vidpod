-- AlterTable
ALTER TABLE "Ad" ADD COLUMN     "s3Key" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ready';

-- CreateIndex
CREATE INDEX "Ad_status_idx" ON "Ad"("status");
