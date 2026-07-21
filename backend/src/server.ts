import 'dotenv/config';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { env } from './config/env';
import { logger } from './lib/logger';
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

export { io };
