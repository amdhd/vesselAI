export interface MockPort {
  id: string;
  name: string;
  code: string;
  country: string;
  lat: number;
  lon: number;
  congestion: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  avgWaitHours: number;
  currentVessels: number;
  nextBerthAvailable: string;
  berthCapacity: number;
  fuelAvailable: boolean;
  pilotageRequired: boolean;
  maxDwt: number;
  forecast: CongestionForecast[];
  agentContacts: AgentContact[];
}

export interface CongestionForecast {
  date: string;
  congestion: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  predictedWaitHours: number;
  confidence: number;
}

export interface AgentContact {
  name: string;
  company: string;
  email: string;
  phone: string;
}

function daysFromNow(days: number, hour: number = 8): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function generateForecast(
  baseCongestion: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
  baseWaitHours: number,
  days: number = 7
): CongestionForecast[] {
  const levels: Array<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'> = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  const levelIndex = levels.indexOf(baseCongestion);
  const forecast: CongestionForecast[] = [];

  for (let i = 0; i < days; i++) {
    const variation = Math.random() > 0.5 ? 1 : -1;
    const newIndex = Math.max(0, Math.min(3, levelIndex + (Math.random() > 0.7 ? variation : 0)));
    const congestion = levels[Math.floor(newIndex)] as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    const waitVariation = baseWaitHours * (0.8 + Math.random() * 0.4);

    forecast.push({
      date: daysFromNow(i),
      congestion,
      predictedWaitHours: parseFloat(waitVariation.toFixed(1)),
      confidence: parseFloat((0.95 - i * 0.05).toFixed(2)),
    });
  }
  return forecast;
}

export const MOCK_PORTS: MockPort[] = [
  {
    id: 'port-001',
    name: 'Port of Fujairah',
    code: 'FJFUJ',
    country: 'UAE',
    lat: 25.12,
    lon: 56.33,
    congestion: 'HIGH',
    avgWaitHours: 48,
    currentVessels: 23,
    nextBerthAvailable: daysFromNow(2, 8),
    berthCapacity: 12,
    fuelAvailable: true,
    pilotageRequired: true,
    maxDwt: 350000,
    forecast: generateForecast('HIGH', 48),
    agentContacts: [
      {
        name: 'Mohammed Al-Rashidi',
        company: 'Gulf Maritime Services LLC',
        email: 'm.alrashidi@gulfmaritime.ae',
        phone: '+971 9 222 4567',
      },
      {
        name: 'Ahmed Bin Khalid',
        company: 'Fujairah Port Agents',
        email: 'ahmed@fujairahagents.ae',
        phone: '+971 9 235 8901',
      },
    ],
  },
  {
    id: 'port-002',
    name: 'Port of Singapore',
    code: 'SGSIN',
    country: 'Singapore',
    lat: 1.26,
    lon: 103.82,
    congestion: 'MEDIUM',
    avgWaitHours: 12,
    currentVessels: 45,
    nextBerthAvailable: daysFromNow(0, 18),
    berthCapacity: 55,
    fuelAvailable: true,
    pilotageRequired: true,
    maxDwt: 400000,
    forecast: generateForecast('MEDIUM', 12),
    agentContacts: [
      {
        name: 'Chen Wei Liang',
        company: 'Pacific Maritime Singapore',
        email: 'cw.liang@pacificmaritime.sg',
        phone: '+65 6220 4321',
      },
    ],
  },
  {
    id: 'port-003',
    name: 'Port of Rotterdam',
    code: 'NLRTM',
    country: 'Netherlands',
    lat: 51.95,
    lon: 4.14,
    congestion: 'LOW',
    avgWaitHours: 6,
    currentVessels: 38,
    nextBerthAvailable: daysFromNow(0, 14),
    berthCapacity: 65,
    fuelAvailable: true,
    pilotageRequired: true,
    maxDwt: 500000,
    forecast: generateForecast('LOW', 6),
    agentContacts: [
      {
        name: 'Pieter van den Berg',
        company: 'Rotterdam Ship Agents BV',
        email: 'p.vandenberg@rotterdamagents.nl',
        phone: '+31 10 411 2345',
      },
    ],
  },
  {
    id: 'port-004',
    name: 'Ras Tanura Terminal',
    code: 'SARUH',
    country: 'Saudi Arabia',
    lat: 26.64,
    lon: 50.16,
    congestion: 'HIGH',
    avgWaitHours: 72,
    currentVessels: 18,
    nextBerthAvailable: daysFromNow(3, 6),
    berthCapacity: 8,
    fuelAvailable: false,
    pilotageRequired: true,
    maxDwt: 500000,
    forecast: generateForecast('HIGH', 72),
    agentContacts: [
      {
        name: 'Khalid Al-Otaibi',
        company: 'Aramco Marine Services',
        email: 'k.alotaibi@aramcomarine.sa',
        phone: '+966 13 357 1234',
      },
    ],
  },
  {
    id: 'port-005',
    name: 'Port Dickson',
    code: 'MYPDI',
    country: 'Malaysia',
    lat: 2.52,
    lon: 101.79,
    congestion: 'LOW',
    avgWaitHours: 4,
    currentVessels: 6,
    nextBerthAvailable: daysFromNow(0, 10),
    berthCapacity: 8,
    fuelAvailable: true,
    pilotageRequired: false,
    maxDwt: 320000,
    forecast: generateForecast('LOW', 4),
    agentContacts: [
      {
        name: 'Razali bin Hassan',
        company: 'Petronas Marine Terminal',
        email: 'razali.hassan@petronas.com.my',
        phone: '+60 6 647 2233',
      },
    ],
  },
  {
    id: 'port-006',
    name: 'Kerteh Marine Terminal',
    code: 'MYKTN',
    country: 'Malaysia',
    lat: 4.49,
    lon: 103.42,
    congestion: 'MEDIUM',
    avgWaitHours: 18,
    currentVessels: 9,
    nextBerthAvailable: daysFromNow(1, 6),
    berthCapacity: 6,
    fuelAvailable: true,
    pilotageRequired: true,
    maxDwt: 160000,
    forecast: generateForecast('MEDIUM', 18),
    agentContacts: [
      {
        name: 'Azman bin Yusof',
        company: 'Kerteh Port Services',
        email: 'azman.yusof@kertehport.com.my',
        phone: '+60 9 826 4455',
      },
    ],
  },
  {
    id: 'port-007',
    name: 'Jurong Island Terminal',
    code: 'SGJUR',
    country: 'Singapore',
    lat: 1.27,
    lon: 103.71,
    congestion: 'MEDIUM',
    avgWaitHours: 24,
    currentVessels: 14,
    nextBerthAvailable: daysFromNow(1, 12),
    berthCapacity: 16,
    fuelAvailable: true,
    pilotageRequired: true,
    maxDwt: 350000,
    forecast: generateForecast('MEDIUM', 24),
    agentContacts: [
      {
        name: 'Li Jian Wei',
        company: 'Jurong Marine Services',
        email: 'ljw@jurongmarine.sg',
        phone: '+65 6265 7890',
      },
    ],
  },
  {
    id: 'port-008',
    name: 'Kharg Island Terminal',
    code: 'IRKHK',
    country: 'Iran',
    lat: 29.27,
    lon: 50.27,
    congestion: 'MEDIUM',
    avgWaitHours: 36,
    currentVessels: 11,
    nextBerthAvailable: daysFromNow(1, 20),
    berthCapacity: 7,
    fuelAvailable: false,
    pilotageRequired: true,
    maxDwt: 400000,
    forecast: generateForecast('MEDIUM', 36),
    agentContacts: [
      {
        name: 'Reza Tehrani',
        company: 'NIOC Marine Terminal',
        email: 'r.tehrani@niocmarine.ir',
        phone: '+98 77 5229 3456',
      },
    ],
  },
];

export const getPortByCode = (code: string): MockPort | undefined => {
  return MOCK_PORTS.find((p) => p.code === code);
};

export const getPortByName = (name: string): MockPort | undefined => {
  return MOCK_PORTS.find((p) => p.name.toLowerCase().includes(name.toLowerCase()));
};
