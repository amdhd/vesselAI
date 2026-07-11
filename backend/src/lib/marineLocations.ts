import { MonitoredPoint } from './openMeteo';

// Points the weather pipeline ingests each cycle — Petronas Marine's core
// SE-Asia operating area (terminals + the shipping lanes between them). Kept as
// a small, explicit list so a reviewer can see exactly what is fetched; in a
// real deployment these would be derived from active voyages/waypoints.
export const MARINE_LOCATIONS: MonitoredPoint[] = [
  { name: 'Port of Singapore', latitude: 1.26, longitude: 103.82 },
  { name: 'Port Klang', latitude: 3.0, longitude: 101.39 },
  { name: 'Kerteh Terminal', latitude: 4.53, longitude: 103.44 },
  { name: 'Bintulu Terminal', latitude: 3.26, longitude: 113.06 },
  { name: 'Malacca Strait', latitude: 2.5, longitude: 101.3 },
  { name: 'South China Sea', latitude: 5.0, longitude: 109.0 },
];
