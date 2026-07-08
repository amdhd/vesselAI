import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
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

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Unmatched API routes → structured 404 (must come after all routes)
app.use('/api', notFound);

// Central error handler — must be the last middleware registered so thrown
// errors and next(err) calls are serialised consistently (no stack leaks in prod)
app.use(errorHandler);

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

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`VesselMind API running on port ${PORT}`);
});

export { io };
