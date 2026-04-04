import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create Fleet
  const fleet = await prisma.fleet.upsert({
    where: { id: 'fleet-001' },
    update: {},
    create: {
      id: 'fleet-001',
      name: 'Petronas Marine Fleet',
      operator: 'Petronas Marine Sdn Bhd',
      country: 'Malaysia',
    },
  });
  console.log('Fleet created:', fleet.name);

  // Create demo user
  const hashedPassword = await bcrypt.hash('demo123', 12);
  const user = await prisma.user.upsert({
    where: { email: 'demo@petronas.com' },
    update: {},
    create: {
      id: 'user-001',
      email: 'demo@petronas.com',
      password: hashedPassword,
      name: 'Captain Ahmad Fauzi',
      role: 'fleet_manager',
      fleetId: 'fleet-001',
    },
  });
  console.log('Demo user created:', user.email);

  // Create Vessels
  const vessel001 = await prisma.vessel.upsert({
    where: { imoNumber: '9876543' },
    update: {},
    create: {
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
      fleetId: 'fleet-001',
      currentLat: 2.5,
      currentLon: 103.5,
      currentSpeed: 13.2,
      status: 'active',
    },
  });

  const vessel002 = await prisma.vessel.upsert({
    where: { imoNumber: '9765432' },
    update: {},
    create: {
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
      fleetId: 'fleet-001',
      currentLat: 1.3,
      currentLon: 104.2,
      currentSpeed: 12.8,
      status: 'active',
    },
  });

  const vessel003 = await prisma.vessel.upsert({
    where: { imoNumber: '9654321' },
    update: {},
    create: {
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
      fleetId: 'fleet-001',
      currentLat: 4.5,
      currentLon: 103.4,
      currentSpeed: 10.5,
      status: 'active',
    },
  });

  console.log('Vessels created:', vessel001.name, vessel002.name, vessel003.name);

  // Create Equipment for vessel-001
  const equipment001 = await prisma.equipment.upsert({
    where: { id: 'tc-001' },
    update: {},
    create: {
      id: 'tc-001',
      vesselId: 'vessel-001',
      name: 'Turbocharger #1 (Port)',
      type: 'Turbocharger',
      maker: 'ABB Turbo Systems',
      model: 'TCA88-21',
      installDate: new Date('2018-04-15'),
      lastMaintenance: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      nextMaintenance: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      healthScore: 62,
      status: 'warning',
    },
  });

  const equipment002 = await prisma.equipment.upsert({
    where: { id: 'me-002' },
    update: {},
    create: {
      id: 'me-002',
      vesselId: 'vessel-002',
      name: 'Main Engine',
      type: 'Main Engine',
      maker: 'MAN Energy Solutions',
      model: '6S60ME-C10.5',
      installDate: new Date('2015-06-20'),
      lastMaintenance: new Date(Date.now() - 80 * 24 * 60 * 60 * 1000),
      nextMaintenance: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      healthScore: 74,
      status: 'warning',
    },
  });

  console.log('Equipment created:', equipment001.name, equipment002.name);

  // Create Maintenance Alerts
  await prisma.maintenanceAlert.upsert({
    where: { id: 'alert-001' },
    update: {},
    create: {
      id: 'alert-001',
      equipmentId: 'tc-001',
      type: 'Vibration Anomaly',
      severity: 'critical',
      description: 'Turbocharger #1 vibration levels have exceeded critical threshold (4.5 mm/s). Current reading: 4.8 mm/s.',
      aiAnalysis: 'Analysis indicates progressive bearing wear. Immediate intervention recommended.',
      daysToFailure: 4,
      status: 'open',
    },
  });

  await prisma.maintenanceAlert.upsert({
    where: { id: 'alert-002' },
    update: {},
    create: {
      id: 'alert-002',
      equipmentId: 'me-002',
      type: 'Overdue Maintenance',
      severity: 'warning',
      description: 'Main Engine cylinder unit overhaul is 2,100 running hours overdue.',
      aiAnalysis: 'The main engine is operating significantly beyond the recommended overhaul interval.',
      daysToFailure: null,
      status: 'open',
    },
  });

  console.log('Maintenance alerts created');

  // Create Emission Logs for vessel-001
  const emissionData = [
    { route: 'Port Dickson - Fujairah', fuelConsumed: 1820, co2Tonnes: 5733, soxTonnes: 5.46, noxTonnes: 91.0 },
    { route: 'Fujairah - Singapore', fuelConsumed: 1298, co2Tonnes: 4089, soxTonnes: 3.89, noxTonnes: 64.9 },
    { route: 'Singapore - Rotterdam', fuelConsumed: 3245, co2Tonnes: 10222, soxTonnes: 9.74, noxTonnes: 162.3 },
    { route: 'Ras Tanura - Port Dickson', fuelConsumed: 1748, co2Tonnes: 5506, soxTonnes: 5.24, noxTonnes: 87.4 },
    { route: 'Port Dickson - Fujairah', fuelConsumed: 1812, co2Tonnes: 5708, soxTonnes: 5.44, noxTonnes: 90.6 },
    { route: 'Fujairah - Singapore', fuelConsumed: 1422, co2Tonnes: 4479, soxTonnes: 4.27, noxTonnes: 71.1 },
  ];

  for (let i = 0; i < emissionData.length; i++) {
    const d = emissionData[i];
    await prisma.emissionLog.create({
      data: {
        vesselId: 'vessel-001',
        date: new Date(Date.now() - (i + 1) * 60 * 24 * 60 * 60 * 1000),
        route: d.route,
        fuelType: 'VLSFO',
        fuelConsumed: d.fuelConsumed,
        co2Tonnes: d.co2Tonnes,
        soxTonnes: d.soxTonnes,
        noxTonnes: d.noxTonnes,
      },
    });
  }

  console.log('Emission logs created');

  // Create SIRE Documents for vessel-001
  await prisma.sireDocument.upsert({
    where: { id: 'doc-001-01' },
    update: {},
    create: {
      id: 'doc-001-01',
      vesselId: 'vessel-001',
      name: 'IOPP Certificate',
      type: 'IOPP',
      category: 'Pollution Prevention',
      status: 'valid',
      expiryDate: new Date(Date.now() + 420 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.sireDocument.upsert({
    where: { id: 'doc-001-02' },
    update: {},
    create: {
      id: 'doc-001-02',
      vesselId: 'vessel-001',
      name: 'Safety Management Certificate (SMC)',
      type: 'SMC',
      category: 'Safety Management',
      status: 'valid',
      expiryDate: new Date(Date.now() + 580 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.sireDocument.upsert({
    where: { id: 'doc-002-01' },
    update: {},
    create: {
      id: 'doc-002-01',
      vesselId: 'vessel-002',
      name: 'IOPP Certificate',
      type: 'IOPP',
      category: 'Pollution Prevention',
      status: 'expired',
      expiryDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    },
  });

  console.log('SIRE documents created');

  // Create Notifications
  await prisma.notification.upsert({
    where: { id: 'notif-001' },
    update: {},
    create: {
      id: 'notif-001',
      vesselId: 'vessel-001',
      type: 'anomaly',
      title: 'Turbocharger Bearing Anomaly',
      message: 'Vibration levels on Turbocharger #1 of MV Merdeka Spirit have reached 4.8 mm/s — 4 days to potential failure',
      severity: 'critical',
      read: false,
    },
  });

  await prisma.notification.upsert({
    where: { id: 'notif-002' },
    update: {},
    create: {
      id: 'notif-002',
      vesselId: 'vessel-002',
      type: 'compliance',
      title: 'CII Rating at Risk',
      message: 'MT Kerteh Venture CII score of 4.82 exceeds required 4.20, currently rated D. Immediate speed reduction recommended.',
      severity: 'warning',
      read: false,
    },
  });

  await prisma.notification.upsert({
    where: { id: 'notif-003' },
    update: {},
    create: {
      id: 'notif-003',
      vesselId: 'vessel-003',
      type: 'commercial',
      title: 'Demurrage Risk',
      message: 'OSV Tenaga Satu approaching laytime limit at Port Fujairah. Estimated demurrage: $12,500/day if delayed further.',
      severity: 'warning',
      read: false,
    },
  });

  console.log('Notifications created');
  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
