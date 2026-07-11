-- CreateTable
CREATE TABLE "WeatherObservation" (
    "id" TEXT NOT NULL,
    "locationName" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "waveHeight" DOUBLE PRECISION,
    "waveDirection" DOUBLE PRECISION,
    "windSpeed" DOUBLE PRECISION,
    "windDirection" DOUBLE PRECISION,
    "currentSpeed" DOUBLE PRECISION,
    "currentDirection" DOUBLE PRECISION,
    "weatherCode" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'open-meteo',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeatherObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeatherObservation_latitude_longitude_idx" ON "WeatherObservation"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "WeatherObservation_latitude_longitude_observedAt_key" ON "WeatherObservation"("latitude", "longitude", "observedAt");
