import type { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './jwtConfig';
import { logger } from './logger';

// Socket.io bypasses Express authentication. Use the same signed fleet claim,
// require a bounded credential, and recheck expiry before joining any room.
export function registerFleetSockets(io: Server): void {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string') {
      next(new Error('Authentication required'));
      return;
    }
    try {
      const claims = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      if (typeof claims === 'string' || typeof claims.id !== 'string' || !claims.id
        || typeof claims.fleetId !== 'string' || !claims.fleetId
        || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
        throw new Error('Invalid claims');
      }
      socket.data.fleetId = claims.fleetId;
      socket.data.expiresAt = claims.exp * 1000;
      next();
    } catch {
      next(new Error('Invalid or expired credentials'));
    }
  });

  io.on('connection', (socket) => {
    logger.debug({ socketId: socket.id }, 'socket client connected');
    // Long-lived connections must not outlive their JWT. Very long tokens are
    // conservatively disconnected at Node's maximum timer delay too.
    const expiry = setTimeout(() => socket.disconnect(true),
      Math.min(socket.data.expiresAt - Date.now(), 2_147_483_647));
    expiry.unref();
    socket.on('subscribe:fleet', (fleetId: unknown, acknowledge?: (result: { ok: boolean }) => void) => {
      const allowed = typeof fleetId === 'string' && fleetId === socket.data.fleetId
        && Date.now() < socket.data.expiresAt;
      if (allowed) void socket.join(`fleet:${socket.data.fleetId}`);
      else if (Date.now() >= socket.data.expiresAt) socket.disconnect(true);
      if (typeof acknowledge === 'function') acknowledge({ ok: allowed });
    });
    socket.on('disconnect', () => {
      clearTimeout(expiry);
      logger.debug({ socketId: socket.id }, 'socket client disconnected');
    });
  });
}
