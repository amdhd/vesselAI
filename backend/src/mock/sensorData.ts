export interface SensorReading {
  timestamp: string;
  parameter: string;
  value: number;
  unit: string;
  isAnomaly: boolean;
}

export interface SensorDataMap {
  [equipmentId: string]: SensorReading[];
}

function hoursAgo(hours: number): Date {
  const d = new Date();
  d.setHours(d.getHours() - hours);
  return d;
}

function randomInRange(min: number, max: number, decimals: number = 2): number {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function addNoise(base: number, noisePercent: number): number {
  const noise = base * (noisePercent / 100) * (Math.random() * 2 - 1);
  return parseFloat((base + noise).toFixed(2));
}

export function generateSensorTimeSeries(
  equipmentId: string,
  days: number,
  params: { name: string; unit: string; min: number; max: number; noisePercent?: number }[]
): SensorReading[] {
  const readings: SensorReading[] = [];
  const totalHours = days * 24;

  for (let h = totalHours; h >= 0; h--) {
    const timestamp = hoursAgo(h).toISOString();
    for (const param of params) {
      const value = randomInRange(param.min, param.max);
      readings.push({
        timestamp,
        parameter: param.name,
        value,
        unit: param.unit,
        isAnomaly: false,
      });
    }
  }
  return readings;
}

// Generate 30-day hourly sensor data for Main Engine vessel-001 (me-001)
function generateMainEngineSensorData(): SensorReading[] {
  const readings: SensorReading[] = [];
  const totalHours = 30 * 24;

  for (let h = totalHours; h >= 0; h--) {
    const timestamp = hoursAgo(h).toISOString();
    const loadFactor = 0.75 + Math.sin(h / 12) * 0.05; // slight cyclic variation

    readings.push({
      timestamp,
      parameter: 'RPM',
      value: addNoise(82 * loadFactor, 0.5),
      unit: 'RPM',
      isAnomaly: false,
    });
    // 6 cylinders exhaust temps
    for (let cyl = 1; cyl <= 6; cyl++) {
      const baseTemp = 340 + cyl * 3;
      readings.push({
        timestamp,
        parameter: `exhaustTemp_cyl${cyl}`,
        value: addNoise(baseTemp * loadFactor, 1.5),
        unit: '°C',
        isAnomaly: false,
      });
    }
    readings.push({
      timestamp,
      parameter: 'fuelRackPosition',
      value: addNoise(68 * loadFactor, 1),
      unit: '%',
      isAnomaly: false,
    });
    readings.push({
      timestamp,
      parameter: 'scavengePressure',
      value: addNoise(2.75 * loadFactor, 0.8),
      unit: 'bar',
      isAnomaly: false,
    });
    readings.push({
      timestamp,
      parameter: 'lubeOilPressure',
      value: addNoise(4.0, 0.5),
      unit: 'bar',
      isAnomaly: false,
    });
    readings.push({
      timestamp,
      parameter: 'coolantTemp',
      value: addNoise(80, 1),
      unit: '°C',
      isAnomaly: false,
    });
  }
  return readings;
}

// Generate CRITICAL turbocharger data for vessel-001 (tc-001)
// Shows gradual vibration increase from 2.1 mm/s to 4.8 mm/s over last 14 days
function generateTurbochargerSensorData(): SensorReading[] {
  const readings: SensorReading[] = [];
  const totalHours = 30 * 24;

  for (let h = totalHours; h >= 0; h--) {
    const timestamp = hoursAgo(h).toISOString();

    // Vibration: from 2.1 (30 days ago) gradually increasing to 4.8 (now)
    // Over last 14 days (336 hours), ramp from 2.1 to 4.8
    let vibration: number;
    const criticalThreshold = 4.5;
    if (h > 14 * 24) {
      // Normal range before the anomaly period
      vibration = addNoise(2.1, 3);
    } else {
      // Linear ramp from 2.1 to 4.8 over 336 hours
      const hoursIntoAnomaly = 14 * 24 - h;
      const rampFraction = hoursIntoAnomaly / (14 * 24);
      const baseVib = 2.1 + (4.8 - 2.1) * rampFraction;
      vibration = addNoise(baseVib, 2);
    }
    const isVibAnomaly = vibration > criticalThreshold;

    readings.push({
      timestamp,
      parameter: 'vibration',
      value: parseFloat(vibration.toFixed(2)),
      unit: 'mm/s',
      isAnomaly: isVibAnomaly,
    });

    // Inlet temperature - slightly elevated as vibration increases
    const inletTempBase = 45 + (h < 14 * 24 ? ((14 * 24 - h) / (14 * 24)) * 8 : 0);
    readings.push({
      timestamp,
      parameter: 'inletTemp',
      value: addNoise(inletTempBase, 1),
      unit: '°C',
      isAnomaly: false,
    });

    // Outlet temperature
    const outletTempBase = 380 + (h < 14 * 24 ? ((14 * 24 - h) / (14 * 24)) * 15 : 0);
    readings.push({
      timestamp,
      parameter: 'outletTemp',
      value: addNoise(outletTempBase, 1.5),
      unit: '°C',
      isAnomaly: h < 2 * 24, // last 2 days are anomalous
    });

    // TC RPM - slightly decreasing efficiency
    const tcrpmBase = 12800 - (h < 14 * 24 ? ((14 * 24 - h) / (14 * 24)) * 400 : 0);
    readings.push({
      timestamp,
      parameter: 'rpm',
      value: addNoise(tcrpmBase, 0.5),
      unit: 'RPM',
      isAnomaly: false,
    });
  }
  return readings;
}

// Generate fuel purifier sensor data (fp-001)
function generateFuelPurifierSensorData(): SensorReading[] {
  const readings: SensorReading[] = [];
  const totalHours = 30 * 24;

  for (let h = totalHours; h >= 0; h--) {
    const timestamp = hoursAgo(h).toISOString();
    readings.push({
      timestamp,
      parameter: 'throughput',
      value: addNoise(2800, 2),
      unit: 'L/hr',
      isAnomaly: false,
    });
    readings.push({
      timestamp,
      parameter: 'backPressure',
      value: addNoise(3.2, 3),
      unit: 'bar',
      isAnomaly: false,
    });
    readings.push({
      timestamp,
      parameter: 'sludgeDischarge',
      value: addNoise(12, 5),
      unit: 'L/hr',
      isAnomaly: false,
    });
    readings.push({
      timestamp,
      parameter: 'bowlSpeed',
      value: addNoise(7200, 0.3),
      unit: 'RPM',
      isAnomaly: false,
    });
    readings.push({
      timestamp,
      parameter: 'inletTemp',
      value: addNoise(98, 1),
      unit: '°C',
      isAnomaly: false,
    });
  }
  return readings;
}

// Auxiliary engine sensor data
function generateAuxEngineSensorData(baseLoad: number = 0.7): SensorReading[] {
  return generateSensorTimeSeries('aux', 30, [
    { name: 'RPM', unit: 'RPM', min: 995, max: 1005 },
    { name: 'exhaustTemp', unit: '°C', min: 280 * baseLoad, max: 320 * baseLoad },
    { name: 'lubeOilPressure', unit: 'bar', min: 3.8, max: 4.2 },
    { name: 'coolantTemp', unit: '°C', min: 78, max: 88 },
    { name: 'loadKW', unit: 'kW', min: 600 * baseLoad, max: 900 * baseLoad },
  ]);
}

// Lube oil purifier sensor data
function generateLubeOilPurifierData(): SensorReading[] {
  return generateSensorTimeSeries('lop', 30, [
    { name: 'throughput', unit: 'L/hr', min: 800, max: 900 },
    { name: 'backPressure', unit: 'bar', min: 2.8, max: 3.4 },
    { name: 'inletTemp', unit: '°C', min: 85, max: 95 },
    { name: 'bowlSpeed', unit: 'RPM', min: 7100, max: 7300 },
  ]);
}

// Fresh water generator sensor data
function generateFWGData(): SensorReading[] {
  return generateSensorTimeSeries('fwg', 30, [
    { name: 'production', unit: 'L/day', min: 18000, max: 25000 },
    { name: 'salinity', unit: 'ppm', min: 1, max: 5 },
    { name: 'vacuumPressure', unit: 'mbar', min: 90, max: 110 },
    { name: 'heatingWaterTemp', unit: '°C', min: 58, max: 65 },
  ]);
}

// Steering gear sensor data
function generateSteeringGearData(): SensorReading[] {
  return generateSensorTimeSeries('sg', 30, [
    { name: 'oilPressure', unit: 'bar', min: 55, max: 65 },
    { name: 'oilTemp', unit: '°C', min: 40, max: 55 },
    { name: 'rudderAngle', unit: 'deg', min: -35, max: 35 },
  ]);
}

// Main cargo pump sensor data
function generateCargoPumpData(): SensorReading[] {
  return generateSensorTimeSeries('cp', 30, [
    { name: 'flowRate', unit: 'm3/hr', min: 2800, max: 3200 },
    { name: 'dischargePressure', unit: 'bar', min: 8, max: 12 },
    { name: 'motorCurrent', unit: 'A', min: 280, max: 320 },
    { name: 'temp', unit: '°C', min: 35, max: 55 },
  ]);
}

// Ballast pump sensor data
function generateBallastPumpData(): SensorReading[] {
  return generateSensorTimeSeries('bp', 30, [
    { name: 'flowRate', unit: 'm3/hr', min: 1800, max: 2200 },
    { name: 'pressure', unit: 'bar', min: 4, max: 6 },
    { name: 'motorCurrent', unit: 'A', min: 150, max: 200 },
  ]);
}

// Vessel 002 main engine - slightly underperforming (high fuel consumption)
function generateVessel002MainEngineSensorData(): SensorReading[] {
  const readings: SensorReading[] = [];
  const totalHours = 30 * 24;

  for (let h = totalHours; h >= 0; h--) {
    const timestamp = hoursAgo(h).toISOString();
    readings.push({
      timestamp,
      parameter: 'RPM',
      value: addNoise(86, 1),
      unit: 'RPM',
      isAnomaly: false,
    });
    for (let cyl = 1; cyl <= 6; cyl++) {
      readings.push({
        timestamp,
        parameter: `exhaustTemp_cyl${cyl}`,
        value: addNoise(360 + cyl * 4, 2),
        unit: '°C',
        isAnomaly: cyl === 4, // cyl 4 slightly elevated
      });
    }
    readings.push({
      timestamp,
      parameter: 'fuelRackPosition',
      value: addNoise(78, 1.5), // slightly high - contributing to poor CII
      unit: '%',
      isAnomaly: false,
    });
    readings.push({
      timestamp,
      parameter: 'scavengePressure',
      value: addNoise(2.65, 1),
      unit: 'bar',
      isAnomaly: false,
    });
    readings.push({
      timestamp,
      parameter: 'lubeOilPressure',
      value: addNoise(3.9, 0.8),
      unit: 'bar',
      isAnomaly: false,
    });
    readings.push({
      timestamp,
      parameter: 'coolantTemp',
      value: addNoise(83, 1.5),
      unit: '°C',
      isAnomaly: false,
    });
  }
  return readings;
}

// Vessel 003 OSV main engines
function generateOSVMainEngineSensorData(): SensorReading[] {
  return generateSensorTimeSeries('osv-me', 30, [
    { name: 'RPM', unit: 'RPM', min: 1450, max: 1550 },
    { name: 'exhaustTemp', unit: '°C', min: 280, max: 360 },
    { name: 'lubeOilPressure', unit: 'bar', min: 3.5, max: 4.5 },
    { name: 'coolantTemp', unit: '°C', min: 72, max: 88 },
    { name: 'fuelRateL_hr', unit: 'L/hr', min: 180, max: 250 },
    { name: 'chargeAirPress', unit: 'bar', min: 1.8, max: 2.4 },
  ]);
}

// Build the complete sensor data map
export const MOCK_SENSOR_DATA: SensorDataMap = {
  // Vessel 001 - MV Merdeka Spirit
  'me-001': generateMainEngineSensorData(),
  'tc-001': generateTurbochargerSensorData(), // CRITICAL ANOMALY
  'tc-002': generateSensorTimeSeries('tc-002', 30, [
    { name: 'vibration', unit: 'mm/s', min: 1.8, max: 2.6 },
    { name: 'inletTemp', unit: '°C', min: 42, max: 50 },
    { name: 'outletTemp', unit: '°C', min: 370, max: 395 },
    { name: 'rpm', unit: 'RPM', min: 12600, max: 13000 },
  ]),
  'fp-001': generateFuelPurifierSensorData(),
  'lop-001': generateLubeOilPurifierData(),
  'fwg-001': generateFWGData(),
  'ae1-001': generateAuxEngineSensorData(0.65),
  'ae2-001': generateAuxEngineSensorData(0.55),
  'sg-001': generateSteeringGearData(),
  'cp1-001': generateCargoPumpData(),
  'cp2-001': generateCargoPumpData(),
  'bp-001': generateBallastPumpData(),

  // Vessel 002 - MT Kerteh Venture
  'me-002': generateVessel002MainEngineSensorData(),
  'tc-003': generateSensorTimeSeries('tc-003', 30, [
    { name: 'vibration', unit: 'mm/s', min: 2.0, max: 3.0 },
    { name: 'inletTemp', unit: '°C', min: 43, max: 52 },
    { name: 'outletTemp', unit: '°C', min: 368, max: 398 },
    { name: 'rpm', unit: 'RPM', min: 12400, max: 12900 },
  ]),
  'tc-004': generateSensorTimeSeries('tc-004', 30, [
    { name: 'vibration', unit: 'mm/s', min: 2.1, max: 2.8 },
    { name: 'inletTemp', unit: '°C', min: 41, max: 50 },
    { name: 'outletTemp', unit: '°C', min: 365, max: 392 },
    { name: 'rpm', unit: 'RPM', min: 12500, max: 12950 },
  ]),
  'fp-002': generateFuelPurifierSensorData(),
  'lop-002': generateLubeOilPurifierData(),
  'fwg-002': generateFWGData(),
  'ae1-002': generateAuxEngineSensorData(0.7),
  'ae2-002': generateAuxEngineSensorData(0.6),
  'sg-002': generateSteeringGearData(),
  'cp1-002': generateCargoPumpData(),
  'cp2-002': generateCargoPumpData(),
  'bp-002': generateBallastPumpData(),

  // Vessel 003 - OSV Tenaga Satu
  'me1-003': generateOSVMainEngineSensorData(),
  'me2-003': generateOSVMainEngineSensorData(),
  'fp-003': generateSensorTimeSeries('fp-003', 30, [
    { name: 'throughput', unit: 'L/hr', min: 800, max: 1000 },
    { name: 'backPressure', unit: 'bar', min: 2.5, max: 3.2 },
    { name: 'inletTemp', unit: '°C', min: 90, max: 100 },
    { name: 'bowlSpeed', unit: 'RPM', min: 7150, max: 7250 },
  ]),
  'lop-003': generateLubeOilPurifierData(),
  'fwg-003': generateFWGData(),
  'ae-003': generateAuxEngineSensorData(0.5),
  'sg-003': generateSteeringGearData(),
  'bp-003': generateBallastPumpData(),
  'bt-003': generateSensorTimeSeries('bt-003', 30, [
    { name: 'thrustPower', unit: 'kW', min: 400, max: 800 },
    { name: 'motorTemp', unit: '°C', min: 55, max: 80 },
    { name: 'rpm', unit: 'RPM', min: 280, max: 320 },
    { name: 'bladePitch', unit: 'deg', min: -25, max: 25 },
  ]),
};

export const getSensorDataForEquipment = (
  equipmentId: string,
  days: number = 30,
  parameter?: string
): SensorReading[] => {
  const data = MOCK_SENSOR_DATA[equipmentId] || [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  return data.filter((r) => {
    const ts = new Date(r.timestamp);
    const inRange = ts >= cutoff;
    const matchesParam = parameter ? r.parameter === parameter : true;
    return inRange && matchesParam;
  });
};
