import type { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, JWT_VERIFY_OPTIONS } from './jwtConfig';
import { logger } from './logger';
import { authorizeClaims, SESSION_CACHE_TTL_MS, type TokenClaims } from './session';

// Socket.io bypasses Express authentication, so this is its own gate, and it
// asks the same two questions as middleware/auth.ts: is this a token the app
// minted, and is it still a valid session? The second is answered by
// lib/session.ts, so REST and sockets cannot disagree about who is signed in.
//
// A socket is long-lived, which is what makes the second question harder here
// than for REST: a REST request is re-checked every time, but a socket that was
// fine at connect can stay open for days. So the session is re-checked
// periodically too, not just at connect and subscribe.

/**
 * How often an open socket's session is re-checked. Matches the session cache
 * window, so a re-check rarely costs a query and a revocation reaches an open
 * socket on about the same timescale as it reaches REST.
 */
export const SOCKET_RECHECK_MS = SESSION_CACHE_TTL_MS;

/**
 * The fleet this session may currently subscribe to, or null when it may not
 * hold a socket at all: revoked, deleted, no fleet, or unverifiable. The fleet
 * is the LIVE one from the database, not the one copied into the token.
 */
async function liveFleet(claims: TokenClaims): Promise<string | null> {
  const auth = await authorizeClaims(claims).catch(() => null);
  if (!auth || !auth.ok) return null;
  return auth.user.fleetId || null;
}

export function registerFleetSockets(io: Server): void {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string') {
      next(new Error('Authentication required'));
      return;
    }
    let claims: jwt.JwtPayload;
    try {
      const verified = jwt.verify(token, JWT_SECRET, JWT_VERIFY_OPTIONS);
      if (typeof verified === 'string' || typeof verified.id !== 'string' || !verified.id
        || typeof verified.exp !== 'number' || !Number.isFinite(verified.exp)) {
        throw new Error('Invalid claims');
      }
      claims = verified;
    } catch {
      next(new Error('Invalid or expired credentials'));
      return;
    }

    // A fleet is still required to hold a socket, but it is the LIVE fleet: a
    // user removed from their fleet since login can no longer connect, and one
    // assigned to a fleet since login can.
    const fleetId = await liveFleet(claims as TokenClaims);
    if (!fleetId) {
      next(new Error('Session not authorized'));
      return;
    }
    socket.data.claims = claims;
    socket.data.fleetId = fleetId;
    socket.data.expiresAt = (claims.exp as number) * 1000;
    next();
  });

  io.on('connection', (socket) => {
    logger.debug({ socketId: socket.id }, 'socket client connected');
    // Long-lived connections must not outlive their JWT. Very long tokens are
    // conservatively disconnected at Node's maximum timer delay too.
    const expiry = setTimeout(() => socket.disconnect(true),
      Math.min(socket.data.expiresAt - Date.now(), 2_147_483_647));
    expiry.unref();

    // Re-read the live session. Returns the fleet the socket may use now, or
    // null after disconnecting it. A fleet change moves the socket out of the
    // old fleet's room, so it stops receiving that fleet's broadcasts.
    const refresh = async (): Promise<string | null> => {
      const fleetId = await liveFleet(socket.data.claims);
      if (!fleetId) {
        socket.disconnect(true);
        return null;
      }
      if (fleetId !== socket.data.fleetId) {
        void socket.leave(`fleet:${socket.data.fleetId}`);
        socket.data.fleetId = fleetId;
      }
      return fleetId;
    };

    const recheck = setInterval(() => void refresh(), SOCKET_RECHECK_MS);
    recheck.unref();

    socket.on('subscribe:fleet', async (fleetId: unknown, acknowledge?: (result: { ok: boolean }) => void) => {
      let allowed = false;
      if (Date.now() >= socket.data.expiresAt) {
        socket.disconnect(true);
      } else {
        // Re-checked here rather than trusting the handshake: subscribing is
        // the moment the socket asks for a fleet's data.
        const live = await refresh();
        allowed = live !== null && typeof fleetId === 'string' && fleetId === live;
        if (allowed) void socket.join(`fleet:${live}`);
      }
      if (typeof acknowledge === 'function') acknowledge({ ok: allowed });
    });
    socket.on('disconnect', () => {
      clearTimeout(expiry);
      clearInterval(recheck);
      logger.debug({ socketId: socket.id }, 'socket client disconnected');
    });
  });
}
