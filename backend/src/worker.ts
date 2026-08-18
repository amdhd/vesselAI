// Background worker: scheduled and streaming work, with no HTTP server.
//
// WHY THIS FILE EXISTS
// These jobs used to run inside server.ts, which means inside EVERY API replica.
// At replicas: 3 — and up to 8 under the HPA — that is 3-8 concurrent weather
// syncs writing the same rows, and 3-8 websocket connections to the same AIS
// feed. The upserts make it survivable rather than correct: it is duplicated
// work, duplicated external API quota, and duplicated write load, scaling with a
// replica count chosen for HTTP traffic and nothing to do with background work.
//
// Splitting it out means the API scales on request load while this scales on
// nothing — exactly one instance, deliberately.
//
// The API's copies stay in server.ts and stay OFF: both flags default to false
// and the API's ConfigMap does not set them. That keeps docker-compose working
// unchanged, where a single process is the whole point.
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { syncWeather } from './services/weatherPipeline';
import { startAisStream } from './services/aisStream';

const log = logger.child({ mod: 'worker' });

// The file an exec probe stats. There is no HTTP endpoint to probe, so liveness
// is expressed as "this file was touched recently".
const HEARTBEAT_PATH = process.env.WORKER_HEARTBEAT_PATH || '/tmp/worker-heartbeat';
const HEARTBEAT_INTERVAL_MS = 15_000;

function beat(): void {
  try {
    writeFileSync(HEARTBEAT_PATH, new Date().toISOString());
  } catch (err) {
    // A heartbeat that cannot be written is itself a failure worth surfacing —
    // but not worth crashing over, since the probe will notice within a minute.
    log.error({ err }, 'failed to write heartbeat');
  }
}

// WHAT THIS HEARTBEAT ACTUALLY PROVES, and it is less than it looks:
// it proves the Node event loop is still turning and timers still fire. That
// catches a wedged or deadlocked process, which is what liveness is for.
//
// It does NOT prove the AIS websocket is connected or that weather syncs are
// succeeding. A probe that claimed to check those would need real connection
// state, and getting it wrong in the other direction is worse: a liveness probe
// that fails on a transient upstream outage restarts a process that was working
// fine, dropping the reconnect backoff and turning a blip into a restart loop.
// Deliberately conservative — failures show up in logs and metrics, not by
// killing the pod.
const heartbeatTimer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
beat();

let weatherTimer: NodeJS.Timeout | undefined;

if (env.ENABLE_WEATHER_SYNC) {
  const intervalMs = env.WEATHER_SYNC_INTERVAL_MS;
  const runSync = () => {
    syncWeather()
      .then((s) => log.info({ ingested: s.ingested, failed: s.failed, ms: s.durationMs }, 'weather sync complete'))
      .catch((err) => log.error({ err }, 'weather sync failed'));
  };
  runSync();
  weatherTimer = setInterval(runSync, intervalMs);
  log.info({ intervalSeconds: Math.round(intervalMs / 1000) }, 'weather ingestion scheduled');
}

if (env.ENABLE_AIS_STREAM) {
  if (!env.AISSTREAM_API_KEY) {
    // Fail loudly rather than idling: a worker that was asked to stream and
    // silently does not is indistinguishable from one that is working.
    log.error('ENABLE_AIS_STREAM is set but AISSTREAM_API_KEY is missing — refusing to start');
    process.exit(1);
  }
  startAisStream(env.AISSTREAM_API_KEY);
  log.info('AIS stream consumer started');
}

if (!env.ENABLE_WEATHER_SYNC && !env.ENABLE_AIS_STREAM) {
  log.warn('no background jobs enabled — worker is idle');
}

// GRACEFUL SHUTDOWN, which server.ts still lacks.
// Kubernetes sends SIGTERM and waits terminationGracePeriodSeconds before
// SIGKILL. Node's default action is to exit immediately, so without this the
// Prisma connection pool is never closed and in-flight writes are abandoned.
async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, 'shutting down');
  clearInterval(heartbeatTimer);
  if (weatherTimer) clearInterval(weatherTimer);
  try {
    await prisma.$disconnect();
  } catch (err) {
    log.error({ err }, 'error during prisma disconnect');
  }
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
