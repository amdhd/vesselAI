// Load .env FIRST, before any import that reads process.env at module-load
// time (aiService constructs the Anthropic client, jwtConfig reads JWT_SECRET).
// A later dotenv.config() would run after those and leave the values undefined.
import 'dotenv/config';
import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import pinoHttp from 'pino-http';
import type { Server as SocketIOServer } from 'socket.io';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { metricsMiddleware, registry } from './lib/metrics';
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
  const trustProxyEnv = env.TRUST_PROXY;
  if (trustProxyEnv !== undefined) {
    const asNumber = Number(trustProxyEnv);
    app.set('trust proxy', Number.isNaN(asNumber) ? trustProxyEnv === 'true' : asNumber);
  } else {
    app.set('trust proxy', false);
  }

  app.use(helmet());

  // Structured per-request logging (attaches req.log, redacts auth headers via
  // the logger's redact config). Health/metrics are logged at debug so probes
  // and scrapes don't flood info-level logs.
  app.use(
    pinoHttp({
      logger,
      customLogLevel: (req, res, err) => {
        if (req.url === '/api/health' || req.url === '/metrics') return 'debug';
        if (res.statusCode >= 500 || err) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    })
  );

  // Record request latency into the Prometheus histogram.
  app.use(metricsMiddleware);

  // Metrics scrape endpoint. Optionally protected with a bearer token — set
  // METRICS_TOKEN in production so the series aren't world-readable.
  app.get('/metrics', async (req: Request, res: Response) => {
    if (env.METRICS_TOKEN && req.headers.authorization !== `Bearer ${env.METRICS_TOKEN}`) {
      res.status(401).end();
      return;
    }
    res.setHeader('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });

  // PROBE ENDPOINTS ARE REGISTERED ABOVE THE RATE LIMITER, deliberately.
  //
  // They used to sit below it. Probes arrive from the kubelet's node IP, not a
  // user's, and at readiness every 10s plus liveness every 20s that is 9
  // requests a minute per pod — roughly 135 in a 15-minute window against a
  // limit of 200. Two thirds of that IP's budget spent on health checks, and a
  // 429 returned to a probe reads as "unhealthy", which restarts a container
  // that was fine. Excluding probes from the limiter is the fix; giving the
  // limiter a bigger number would only move the problem.

  /**
   * LIVENESS: is this process wedged?
   *
   * Deliberately does NOT touch the database. A liveness probe that fails on a
   * database outage restarts every pod in a loop while the database is down —
   * turning a dependency outage into an application outage as well, and
   * discarding warm connection pools exactly when reconnecting is expensive.
   */
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  /**
   * READINESS: can this pod actually serve a request?
   *
   * It CAN touch the database, and must. Prisma connects lazily, so a pod whose
   * database is unreachable still answers /api/health with 200 — it reports
   * Ready, receives traffic and 500s it.
   *
   * The failure that makes this more than cosmetic is a rolling update: if new
   * pods cannot reach Postgres (a bad secret, a NetworkPolicy, a wrong host),
   * a liveness-style check passes, Kubernetes marks them Ready and retires the
   * healthy old pods. A readiness probe that tests the dependency stops the
   * rollout instead, leaving the working pods in place.
   *
   * `SELECT 1` rather than a real query: it proves the connection pool can
   * reach the server and get an answer, without depending on any table existing
   * or on data that might legitimately be empty.
   */
  app.get('/api/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ready' });
    } catch (err) {
      // 503, not 500: this is "not ready yet", which is what readiness means.
      // The reason is logged rather than returned — a probe endpoint should not
      // disclose connection strings or driver internals to whoever can reach it.
      logger.warn({ err }, 'readiness check failed');
      res.status(503).json({ status: 'not ready' });
    }
  });

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
    origin: env.FRONTEND_URL,
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

  // Unmatched API routes → structured 404 (must come after all routes)
  app.use('/api', notFound);

  // Central error handler — must be the last middleware registered so thrown
  // errors and next(err) calls are serialised consistently (no stack leaks in prod)
  app.use(errorHandler);

  return app;
}
