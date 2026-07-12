// Load .env FIRST, before any import that reads process.env at module-load
// time (aiService constructs the Anthropic client, jwtConfig reads JWT_SECRET).
// A later dotenv.config() would run after those and leave the values undefined.
import 'dotenv/config';
import express, { Application } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import type { Server as SocketIOServer } from 'socket.io';
import { apiLimiter, authLimiter } from './middleware/rateLimiter';
import { errorHandler, notFound } from './middleware/errorHandler';
import authRoutes from './routes/auth';
import fleetRoutes from './routes/fleet';
import voyageRoutes from './routes/voyage';
import maintenanceRoutes from './routes/maintenance';
import complianceRoutes from './routes/compliance';
import portsRoutes from './routes/ports';
import knowledgeRoutes from './routes/knowledge';
import sireRoutes from './routes/sire';
import notificationRoutes from './routes/notifications';
import weatherRoutes from './routes/weather';
import aisRoutes from './routes/ais';
import importRoutes from './routes/imports';

/**
 * Builds the Express app in isolation from the HTTP/Socket.io server so it
 * can be exercised directly in route-integration tests (supertest) without
 * binding a port. `server.ts` calls this with a real Socket.io instance;
 * tests call it with none, which is fine since no route currently reads
 * req.io.
 */
export function createApp(io?: SocketIOServer): Application {
  const app = express();

  // Trust proxy configuration. When deployed behind a reverse proxy / load
  // balancer, set TRUST_PROXY to the number of proxy hops (e.g. 1) so req.ip
  // reflects the real client for rate limiting. Left OFF by default: trusting
  // X-Forwarded-For when NOT behind a proxy would let clients spoof their IP
  // and bypass IP-based limits. Accepts a hop count or 'true'/'false'.
  const trustProxyEnv = process.env.TRUST_PROXY;
  if (trustProxyEnv !== undefined) {
    const asNumber = Number(trustProxyEnv);
    app.set('trust proxy', Number.isNaN(asNumber) ? trustProxyEnv === 'true' : asNumber);
  } else {
    app.set('trust proxy', false);
  }

  app.use(helmet());
  app.use(apiLimiter);
  app.use(compression({
    // Skip SSE streams — compression buffers responses and breaks streaming
    filter: (_req, res) => {
      const ct = res.getHeader('Content-Type') as string | undefined;
      if (ct && ct.includes('text/event-stream')) return false;
      return compression.filter(_req, res);
    },
  }));
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  }));
  // Bodies are small JSON payloads (chat messages, form fields). Keep the
  // limit tight to avoid memory-pressure/DoS from oversized requests.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Attach io to req
  app.use((req: any, _res, next) => {
    req.io = io;
    next();
  });

  // Routes
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/auth', authRoutes);
  app.use('/api', fleetRoutes);
  app.use('/api/voyage', voyageRoutes);
  app.use('/api/maintenance', maintenanceRoutes);
  app.use('/api/compliance', complianceRoutes);
  app.use('/api/ports', portsRoutes);
  app.use('/api/knowledge', knowledgeRoutes);
  app.use('/api/sire', sireRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/weather', weatherRoutes);
  app.use('/api/ais', aisRoutes);
  app.use('/api/imports', importRoutes);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Unmatched API routes → structured 404 (must come after all routes)
  app.use('/api', notFound);

  // Central error handler — must be the last middleware registered so thrown
  // errors and next(err) calls are serialised consistently (no stack leaks in prod)
  app.use(errorHandler);

  return app;
}
