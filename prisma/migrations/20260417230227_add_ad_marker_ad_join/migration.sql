/*
  Warnings:

  - You are about to drop the column `adId` on the `AdMarker` table. All the data in the column will be lost.
  - The `status` column on the `Video` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('pending', 'uploaded', 'chunking', 'completed');

-- DropForeignKey
ALTER TABLE "AdMarker" DROP CONSTRAINT "AdMarker_adId_fkey";

-- AlterTable
ALTER TABLE "AdMarker" DROP COLUMN "adId";

-- AlterTable
ALTER TABLE "Video" DROP COLUMN "status",
ADD COLUMN     "status" "VideoStatus" NOT NULL DEFAULT 'pending';

-- CreateTable
CREATE TABLE "AdMarkerAd" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "markerId" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdMarkerAd_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdMarkerAd_markerId_idx" ON "AdMarkerAd"("markerId");

-- CreateIndex
CREATE INDEX "AdMarkerAd_adId_idx" ON "AdMarkerAd"("adId");

-- CreateIndex
CREATE UNIQUE INDEX "AdMarkerAd_markerId_adId_key" ON "AdMarkerAd"("markerId", "adId");

-- CreateIndex
CREATE INDEX "Video_status_idx" ON "Video"("status");

-- AddForeignKey
ALTER TABLE "AdMarkerAd" ADD CONSTRAINT "AdMarkerAd_markerId_fkey" FOREIGN KEY ("markerId") REFERENCES "AdMarker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdMarkerAd" ADD CONSTRAINT "AdMarkerAd_adId_fkey" FOREIGN KEY ("adId") REFERENCES "Ad"("id") ON DELETE CASCADE ON UPDATE CASCADE;
