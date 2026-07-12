import 'dotenv/config';
import { createServer } from 'http';
import { Server } from 'socket.io';
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
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

const app = createApp(io);
httpServer.on('request', app);

// Socket.io for real-time vessel tracking
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('subscribe:fleet', (fleetId: string) => {
    socket.join(`fleet:${fleetId}`);
  });
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Simulate vessel position updates every 30 seconds
setInterval(() => {
  io.emit('vessels:positions', { timestamp: new Date().toISOString() });
}, 30000);

// Scheduled Open-Meteo Marine ingestion. Off by default; enable with
// ENABLE_WEATHER_SYNC=true once DATABASE_URL points at a reachable Postgres.
// Runs once on boot, then on WEATHER_SYNC_INTERVAL_MS (default 15 min).
if (process.env.ENABLE_WEATHER_SYNC === 'true') {
  const intervalMs = Number(process.env.WEATHER_SYNC_INTERVAL_MS) || 15 * 60 * 1000;
  const runSync = () => {
    syncWeather().catch((err) => console.error('[weather] scheduled sync error:', err));
  };
  runSync();
  setInterval(runSync, intervalMs);
  console.log(`[weather] scheduled ingestion every ${Math.round(intervalMs / 1000)}s`);
}

// Live AIS vessel-position streaming from aisstream.io. Off by default; enable
// with ENABLE_AIS_STREAM=true and a AISSTREAM_API_KEY in the environment.
if (process.env.ENABLE_AIS_STREAM === 'true') {
  startAisStream(process.env.AISSTREAM_API_KEY);
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`VesselMind API running on port ${PORT}`);
});

export { io };
