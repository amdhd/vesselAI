-- CreateTable
CREATE TABLE "AisVesselPosition" (
    "id" TEXT NOT NULL,
    "mmsi" INTEGER NOT NULL,
    "shipName" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "sog" DOUBLE PRECISION,
    "cog" DOUBLE PRECISION,
    "heading" INTEGER,
    "navStatus" INTEGER,
    "timeUtc" TEXT,
    "source" TEXT NOT NULL DEFAULT 'aisstream',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AisVesselPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AisVesselPosition_mmsi_key" ON "AisVesselPosition"("mmsi");

-- CreateIndex
CREATE INDEX "AisVesselPosition_latitude_longitude_idx" ON "AisVesselPosition"("latitude", "longitude");
