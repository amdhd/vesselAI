import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
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
