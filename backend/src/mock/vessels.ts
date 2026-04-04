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
  },
];

export const getVesselById = (id: string): MockVessel | undefined => {
  return MOCK_VESSELS.find((v) => v.id === id);
};

export const getVesselByImo = (imoNumber: string): MockVessel | undefined => {
  return MOCK_VESSELS.find((v) => v.imoNumber === imoNumber);
};
