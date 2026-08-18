// k6 load test for the VesselMind API, driven through the Ingress.
//
// Deliberately hits http://localhost:8080 rather than a port-forward to the
// Service: that exercises the real path a browser takes — serverlb -> Traefik ->
// Service -> EndpointSlice -> pod — so Traefik's own capacity is part of the
// measurement rather than being quietly skipped.
//
// The endpoint under test is GET /api/fleet: authenticated, and backed by a
// Postgres query through Prisma. /api/health would produce prettier numbers and
// prove nothing, because it never touches the database.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:8080';

const fleetLatency = new Trend('fleet_latency', true);
const rateLimited = new Rate('rate_limited_429');

export const options = {
  stages: [
    { duration: '30s', target: 60 },  // ramp: give the HPA something to react to
    { duration: '120s', target: 60 }, // hold: long enough for pods to start and absorb load
    { duration: '30s', target: 0 },   // ramp down: scale-down is stabilised for 5 min, so this won't shrink
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
    rate_limited_429: ['rate<0.01'],
  },
};

// Log in once, outside the measured load. authLimiter allows only 5 attempts
// per 15 min, but skipSuccessfulRequests means successful logins are not
// counted — so a single setup login is safe where a per-VU login would not be.
export function setup() {
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({
    email: 'demo@petronas.com',
    password: 'demo123',
  }), { headers: { 'Content-Type': 'application/json' } });

  if (res.status !== 200) throw new Error(`setup login failed: ${res.status} ${res.body}`);
  return { token: res.json('token') };
}

export default function (data) {
  const res = http.get(`${BASE}/api/fleet`, {
    headers: { Authorization: `Bearer ${data.token}` },
    tags: { endpoint: 'fleet' },
  });

  fleetLatency.add(res.timings.duration);
  rateLimited.add(res.status === 429);

  check(res, {
    'status 200': (r) => r.status === 200,
    'has vessels': (r) => r.status === 200 && Array.isArray(r.json('vessels')),
  });

  sleep(0.1);
}

export function handleSummary(data) {
  return { 'loadtest-summary.json': JSON.stringify(data, null, 2) };
}
