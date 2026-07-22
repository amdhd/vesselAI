export interface MockVessel {
  id: string;
  name: string;
  imoNumber: string;
  type: string;
  flag: string;
  builtYear: number;
  dwt: number;
  engineType: string;
  enginePower: number;
  maxSpeed: number;
  designSpeed: number;
  fuelCapacity: number;
  currentLat: number;
  currentLon: number;
  currentSpeed: number;
  status: string;
  fleetId: string;
  /** Lightship (empty) weight in metric tonnes — used by the Admiralty Coefficient model */
  lightshipTonnage: number;
  /** Reference SFOC at 100 % MCR in g/kWh — used by the speed-power curve (Layer 3) */
  sfocRefGPerKwh: number;
  /** ISO date of last drydock — used to compute hull fouling penalty */
  lastDrydockDate: string;
}

export interface MockFleet {
  id: string;
  name: string;
  operator: string;
  country: string;
}

export const MOCK_FLEET: MockFleet = {
  id: 'fleet-001',
  name: 'Petronas Marine Fleet',
  operator: 'Petronas Marine Sdn Bhd',
  country: 'Malaysia',
};

export const MOCK_VESSELS: MockVessel[] = [
  {
    id: 'vessel-001',
    name: 'MV Merdeka Spirit',
    imoNumber: '9876543',
    type: 'VLCC',
    flag: 'Malaysia',
    builtYear: 2018,
    dwt: 300000,
    engineType: 'MAN B&W 6G80ME-C',
    enginePower: 31640,
    maxSpeed: 16.5,
    designSpeed: 14.0,
    fuelCapacity: 8500,
    currentLat: 2.5,
    currentLon: 103.5,
    currentSpeed: 13.2,
    status: 'active',
    fleetId: 'fleet-001',
    // Fuel model parameters (Layers 2 & 3)
    lightshipTonnage: 42000,       // typical VLCC lightship ~14 % of DWT
    sfocRefGPerKwh: 160,           // MAN B&W 6G80ME-C at MCR (g/kWh)
    lastDrydockDate: '2024-10-15', // ~18 months ago → ~18 % fouling penalty
  },
  {
    id: 'vessel-002',
    name: 'MT Kerteh Venture',
    imoNumber: '9765432',
    type: 'Aframax Tanker',
    flag: 'Malaysia',
    builtYear: 2015,
    dwt: 115000,
    engineType: 'MAN B&W 6S60ME-C',
    enginePower: 13560,
    maxSpeed: 15.0,
    designSpeed: 13.0,
    fuelCapacity: 3800,
    currentLat: 1.3,
    currentLon: 104.2,
    currentSpeed: 12.8,
    status: 'active',
    fleetId: 'fleet-001',
    // Fuel model parameters (Layers 2 & 3)
    lightshipTonnage: 15000,       // typical Aframax lightship ~13 % of DWT
    sfocRefGPerKwh: 168,           // MAN B&W 6S60ME-C at MCR (g/kWh), slightly older engine
    lastDrydockDate: '2023-11-01', // ~29 months ago → capped at 20 % fouling penalty
  },
  {
    id: 'vessel-003',
    name: 'OSV Tenaga Satu',
    imoNumber: '9654321',
    type: 'Offshore Supply Vessel',
    flag: 'Malaysia',
    builtYear: 2020,
    dwt: 4500,
    engineType: 'Caterpillar 3516C Dual Engine',
    enginePower: 4000,
    maxSpeed: 14.0,
    designSpeed: 12.0,
    fuelCapacity: 850,
    currentLat: 4.5,
    currentLon: 103.4,
    currentSpeed: 10.5,
    status: 'active',
    fleetId: 'fleet-001',
    // Fuel model parameters (Layers 2 & 3)
    lightshipTonnage: 1125,        // OSV lightship ~25 % of DWT
    sfocRefGPerKwh: 210,           // Caterpillar 3516C medium-speed 4-stroke (g/kWh)
    lastDrydockDate: '2025-08-20', // ~8 months ago → ~7.6 % fouling penalty
  },
  // ---------------------------------------------------------------------------
  // Additional fleet-001 vessels. These broaden the fixture set so the frontends
  // (the Angular ops dashboard in particular) can exercise table pagination,
  // multi-field filtering and status/type breakdowns against realistic variety
  // even without a seeded Postgres. All belong to fleet-001 so the demo user
  // sees them; the tenant-isolation tests only reference vessel-001..003 and
  // non-existent ids, so appending here does not affect them.
  {
    id: 'vessel-004',
    name: 'MT Pengerang Star',
    imoNumber: '9543210',
    type: 'Suezmax Tanker',
    flag: 'Malaysia',
    builtYear: 2016,
    dwt: 158000,
    engineType: 'MAN B&W 6S70ME-C',
    enginePower: 18660,
    maxSpeed: 15.5,
    designSpeed: 13.5,
    fuelCapacity: 5200,
    currentLat: 1.27,
    currentLon: 104.85,
    currentSpeed: 0,
    status: 'anchored',
    fleetId: 'fleet-001',
    lightshipTonnage: 22000,
    sfocRefGPerKwh: 165,
    lastDrydockDate: '2024-03-10',
  },
  {
    id: 'vessel-005',
    name: 'LNG Bintulu Pride',
    imoNumber: '9432109',
    type: 'LNG Carrier',
    flag: 'Malaysia',
    builtYear: 2019,
    dwt: 96000,
    engineType: 'WinGD X72DF Dual-Fuel',
    enginePower: 22000,
    maxSpeed: 19.5,
    designSpeed: 17.0,
    fuelCapacity: 6400,
    currentLat: 8.9,
    currentLon: 110.2,
    currentSpeed: 16.8,
    status: 'in_transit',
    fleetId: 'fleet-001',
    lightshipTonnage: 34000,
    sfocRefGPerKwh: 140,
    lastDrydockDate: '2025-01-22',
  },
  {
    id: 'vessel-006',
    name: 'MV Langkawi Trader',
    imoNumber: '9321098',
    type: 'Bulk Carrier',
    flag: 'Malaysia',
    builtYear: 2013,
    dwt: 82000,
    engineType: 'MAN B&W 6S60ME-C',
    enginePower: 12200,
    maxSpeed: 14.5,
    designSpeed: 12.5,
    fuelCapacity: 3200,
    currentLat: 5.4,
    currentLon: 100.3,
    currentSpeed: 11.9,
    status: 'in_transit',
    fleetId: 'fleet-001',
    lightshipTonnage: 13500,
    sfocRefGPerKwh: 170,
    lastDrydockDate: '2023-11-05',
  },
  {
    id: 'vessel-007',
    name: 'MV Malacca Express',
    imoNumber: '9210987',
    type: 'Container Ship',
    flag: 'Singapore',
    builtYear: 2021,
    dwt: 120000,
    engineType: 'MAN B&W 9S90ME-C',
    enginePower: 47500,
    maxSpeed: 22.0,
    designSpeed: 19.0,
    fuelCapacity: 9800,
    currentLat: 2.1,
    currentLon: 102.2,
    currentSpeed: 18.4,
    status: 'in_transit',
    fleetId: 'fleet-001',
    lightshipTonnage: 30000,
    sfocRefGPerKwh: 155,
    lastDrydockDate: '2025-05-18',
  },
  {
    id: 'vessel-008',
    name: 'MT Labuan Chemist',
    imoNumber: '9109876',
    type: 'Chemical Tanker',
    flag: 'Malaysia',
    builtYear: 2015,
    dwt: 45000,
    engineType: 'MAN B&W 6S50ME-C',
    enginePower: 8200,
    maxSpeed: 15.0,
    designSpeed: 13.0,
    fuelCapacity: 1900,
    currentLat: 5.28,
    currentLon: 115.24,
    currentSpeed: 0,
    status: 'maintenance',
    fleetId: 'fleet-001',
    lightshipTonnage: 9500,
    sfocRefGPerKwh: 172,
    lastDrydockDate: '2022-09-30',
  },
  {
    id: 'vessel-009',
    name: 'MT Miri Product',
    imoNumber: '9098765',
    type: 'Product Tanker',
    flag: 'Malaysia',
    builtYear: 2017,
    dwt: 51000,
    engineType: 'MAN B&W 6S50ME-C',
    enginePower: 8900,
    maxSpeed: 15.2,
    designSpeed: 13.2,
    fuelCapacity: 2100,
    currentLat: 4.4,
    currentLon: 114.0,
    currentSpeed: 12.6,
    status: 'in_transit',
    fleetId: 'fleet-001',
    lightshipTonnage: 10500,
    sfocRefGPerKwh: 171,
    lastDrydockDate: '2024-07-14',
  },
  {
    id: 'vessel-010',
    name: 'OSV Tenaga Dua',
    imoNumber: '9087654',
    type: 'Offshore Supply Vessel',
    flag: 'Malaysia',
    builtYear: 2022,
    dwt: 4700,
    engineType: 'Caterpillar 3516C Dual Engine',
    enginePower: 4200,
    maxSpeed: 14.0,
    designSpeed: 12.0,
    fuelCapacity: 900,
    currentLat: 4.6,
    currentLon: 103.6,
    currentSpeed: 0,
    status: 'anchored',
    fleetId: 'fleet-001',
    lightshipTonnage: 1175,
    sfocRefGPerKwh: 210,
    lastDrydockDate: '2025-06-01',
  },
  {
    id: 'vessel-011',
    name: 'MV Sabah Voyager',
    imoNumber: '9076543',
    type: 'Bulk Carrier',
    flag: 'Panama',
    builtYear: 2011,
    dwt: 76000,
    engineType: 'MAN B&W 6S60MC-C',
    enginePower: 11300,
    maxSpeed: 14.2,
    designSpeed: 12.2,
    fuelCapacity: 3000,
    currentLat: 6.1,
    currentLon: 116.1,
    currentSpeed: 0,
    status: 'maintenance',
    fleetId: 'fleet-001',
    lightshipTonnage: 12800,
    sfocRefGPerKwh: 175,
    lastDrydockDate: '2023-02-19',
  },
  {
    id: 'vessel-012',
    name: 'MT Kuantan Spirit',
    imoNumber: '9065432',
    type: 'Aframax Tanker',
    flag: 'Malaysia',
    builtYear: 2014,
    dwt: 112000,
    engineType: 'MAN B&W 6S60ME-C',
    enginePower: 13500,
    maxSpeed: 15.3,
    designSpeed: 13.3,
    fuelCapacity: 4100,
    currentLat: 3.8,
    currentLon: 103.4,
    currentSpeed: 13.0,
    status: 'active',
    fleetId: 'fleet-001',
    lightshipTonnage: 16500,
    sfocRefGPerKwh: 168,
    lastDrydockDate: '2024-12-08',
  },
];

export const getVesselById = (id: string): MockVessel | undefined => {
  return MOCK_VESSELS.find((v) => v.id === id);
};

export const getVesselByImo = (imoNumber: string): MockVessel | undefined => {
  return MOCK_VESSELS.find((v) => v.imoNumber === imoNumber);
};
