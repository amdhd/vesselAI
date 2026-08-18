import 'dotenv/config';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { createApp } from './app';
import { syncWeather } from './services/weatherPipeline';
import { startAisStream } from './services/aisStream';

// Socket.io needs the httpServer before the Express app can wire up the
// req.io middleware, so the server is built bare and the app attached as its
// request handler afterwards (equivalent to createServer(app), just ordered
// so `io` exists before createApp() runs).
const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: env.FRONTEND_URL,
    methods: ['GET', 'POST'],
  },
});

const app = createApp(io);
httpServer.on('request', app);

// Socket.io for real-time vessel tracking
io.on('connection', (socket) => {
  logger.debug({ socketId: socket.id }, 'socket client connected');
  socket.on('subscribe:fleet', (fleetId: string) => {
    socket.join(`fleet:${fleetId}`);
  });
  socket.on('disconnect', () => {
    logger.debug({ socketId: socket.id }, 'socket client disconnected');
  });
});

// Simulate vessel position updates every 30 seconds
setInterval(() => {
  io.emit('vessels:positions', { timestamp: new Date().toISOString() });
}, 30000);

// Scheduled Open-Meteo Marine ingestion. Off by default; enable with
// ENABLE_WEATHER_SYNC=true once DATABASE_URL points at a reachable Postgres.
// Runs once on boot, then on WEATHER_SYNC_INTERVAL_MS (default 15 min).
if (env.ENABLE_WEATHER_SYNC) {
  const intervalMs = env.WEATHER_SYNC_INTERVAL_MS;
  const runSync = () => {
    syncWeather().catch((err) => logger.error({ err }, 'scheduled weather sync failed'));
  };
  runSync();
  setInterval(runSync, intervalMs);
  logger.info({ intervalSeconds: Math.round(intervalMs / 1000) }, 'weather ingestion scheduled');
}

// Live AIS vessel-position streaming from aisstream.io. Off by default; enable
// with ENABLE_AIS_STREAM=true and a AISSTREAM_API_KEY in the environment.
if (env.ENABLE_AIS_STREAM) {
  startAisStream(env.AISSTREAM_API_KEY);
}

httpServer.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'VesselMind API listening');
});

// GRACEFUL SHUTDOWN.
//
// Kubernetes sends SIGTERM, then waits terminationGracePeriodSeconds before
// SIGKILL. Node's DEFAULT action on SIGTERM is to exit immediately — so without
// this handler every rollout, scale-down and node drain severs in-flight
// requests, and the client sees a connection reset rather than a response.
// Lengthening the grace period does not help: the process was never using it.
//
// ORDERING MATTERS, and it is the part that is easy to get wrong:
//   1. Stop accepting NEW connections (httpServer.close) while continuing to
//      serve the ones already in flight.
//   2. Close Socket.io so clients get a clean disconnect and reconnect to
//      another replica, instead of hanging on a dead socket.
//   3. Only then release the database pool. Disconnecting Prisma first would
//      break exactly the requests this is meant to protect.
//
// There is still a race Kubernetes cannot close for us: the pod is removed from
// Service endpoints asynchronously, so traffic can arrive for a moment after
// SIGTERM. The usual mitigation is a preStop sleep of a few seconds before the
// signal, giving endpoint propagation time to win.
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return; // a second signal must not restart the sequence
  shuttingDown = true;
  logger.info({ signal }, 'shutdown initiated — draining');

  // Hard deadline. If a long-lived connection refuses to drain, exit anyway
  // rather than waiting for SIGKILL, so the exit code stays meaningful. Set
  // below the 30s grace period so this wins the race.
  const forceExit = setTimeout(() => {
    logger.warn('drain timed out — forcing exit');
    process.exit(1);
  }, 25_000);
  forceExit.unref();

  try {
    // Stop accepting NEW connections. The callback fires only once every
    // existing connection has closed, so this promise IS the drain.
    const closed = new Promise<void>((resolve, reject) =>
      httpServer.close((err) => {
        // ERR_SERVER_NOT_RUNNING means something already closed it — that is a
        // successful outcome for a shutdown path, not a failure.
        if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(err);
        else resolve();
      })
    );

    // Without this the drain never completes. Two things hold connections open
    // indefinitely and neither ends on its own:
    //   - Socket.io clients, which are long-lived by design. disconnectSockets
    //     sends a proper disconnect so browsers reconnect to another replica
    //     rather than hanging on a dead socket.
    //   - HTTP keep-alive connections sitting idle between requests.
    // NOTE: io.close() is deliberately NOT used here. It closes the underlying
    // HTTP server too, which then makes httpServer.close() fail with
    // ERR_SERVER_NOT_RUNNING — observed on the first version of this handler.
    io.disconnectSockets(true);
    httpServer.closeIdleConnections?.();

    await closed;
    await prisma.$disconnect();
    logger.info('drain complete');
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export { io };
