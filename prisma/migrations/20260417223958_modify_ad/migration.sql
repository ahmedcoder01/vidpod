/*
  Warnings:

  - You are about to drop the column `assetUrl` on the `AdMarker` table. All the data in the column will be lost.
  - You are about to drop the column `assetUrls` on the `AdMarker` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Ad" ADD COLUMN     "isPublicAd" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AdMarker" DROP COLUMN "assetUrl",
DROP COLUMN "assetUrls",
ADD COLUMN     "adId" TEXT;

-- CreateIndex
CREATE INDEX "Ad_isPublicAd_idx" ON "Ad"("isPublicAd");

-- AddForeignKey
ALTER TABLE "AdMarker" ADD CONSTRAINT "AdMarker_adId_fkey" FOREIGN KEY ("adId") REFERENCES "Ad"("id") ON DELETE SET NULL ON UPDATE CASCADE;
