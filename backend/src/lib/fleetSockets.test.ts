import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Server, Socket } from 'socket.io';

// The User table the session check reads: one row for dummy-user, editable per
// test to model a demotion, a fleet move, a deletion or a revoke.
const db = vi.hoisted(() => ({ row: null as null | Record<string, unknown> }));
vi.mock('./prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string } }) =>
        db.row && where.id === 'dummy-user' ? { ...db.row } : null),
    },
  },
}));

import { registerFleetSockets, SOCKET_RECHECK_MS } from './fleetSockets';
import { JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE } from './jwtConfig';
import { clearSessionCache } from './session';

const CONTRACT = { issuer: JWT_ISSUER, audience: JWT_AUDIENCE };

type Next = (error?: Error) => void;
let authorize: (socket: Socket, next: Next) => Promise<void>;
let connect: (socket: Socket) => void;
const handlers = new Map<string, (...args: any[]) => any>();

function socket(token: unknown) {
  return {
    id: 'dummy-socket', handshake: { auth: { token } }, data: {},
    join: vi.fn(), leave: vi.fn(), disconnect: vi.fn(),
    on: vi.fn((event, handler) => { handlers.set(event, handler); }),
  } as unknown as Socket;
}
function sign(fleetId: unknown = 'fleet-a', expiresIn = 60) {
  return jwt.sign({ id: 'dummy-user', fleetId }, JWT_SECRET, { expiresIn, ...CONTRACT });
}
async function accepted(token: string) {
  const client = socket(token);
  const next = vi.fn();
  await authorize(client, next);
  expect(next).toHaveBeenCalledWith();
  connect(client);
  return client;
}
async function rejected(token: unknown) {
  const next = vi.fn();
  await authorize(socket(token), next);
  expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
}
const subscribe = (fleetId: unknown, acknowledge?: (r: { ok: boolean }) => void) =>
  handlers.get('subscribe:fleet')!(fleetId, acknowledge);
/** Model the session cache window passing, so the next check re-reads the row. */
const cacheExpires = () => clearSessionCache();

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  clearSessionCache();
  db.row = { role: 'fleet_manager', fleetId: 'fleet-a', tokensValidAfter: null };
  const io = {
    use: (fn: typeof authorize) => { authorize = fn; },
    on: (_event: string, fn: typeof connect) => { connect = fn; },
  } as unknown as Server;
  registerFleetSockets(io);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('fleet socket authorization', () => {
  it.each([undefined, { token: 'wrong shape' }, 'invalid-token'])('rejects missing or malformed credentials: %j', async (token) => {
    await rejected(token);
  });

  it('rejects wrong signatures, expired tokens, unbounded or anonymous tokens, and tokens outside the contract', async () => {
    for (const token of [
      jwt.sign({ id: 'dummy-user', fleetId: 'fleet-a' }, 'a-different-dummy-secret', { expiresIn: 60, ...CONTRACT }),
      sign('fleet-a', -1),
      jwt.sign({ id: 'dummy-user', fleetId: 'fleet-a' }, JWT_SECRET, CONTRACT), // no exp
      jwt.sign({ fleetId: 'fleet-a' }, JWT_SECRET, { expiresIn: 60, ...CONTRACT }), // no id
      jwt.sign({ id: 'dummy-user', fleetId: 'fleet-a' }, JWT_SECRET, { expiresIn: 60, issuer: JWT_ISSUER, audience: 'some-other-service' }),
      jwt.sign({ id: 'dummy-user', fleetId: 'fleet-a' }, JWT_SECRET, { expiresIn: 60 }),
    ]) {
      await rejected(token);
    }
  });

  it('joins only the authenticated fleet and refuses forged room selectors', async () => {
    const client = await accepted(sign());
    const acknowledge = vi.fn();
    await subscribe('fleet-b', acknowledge);
    await subscribe({ fleetId: 'fleet-a' }, acknowledge);
    expect(client.join).not.toHaveBeenCalled();
    expect(acknowledge).toHaveBeenCalledWith({ ok: false });
    await subscribe('fleet-a', acknowledge);
    expect(client.join).toHaveBeenCalledExactlyOnceWith('fleet:fleet-a');
    expect(acknowledge).toHaveBeenLastCalledWith({ ok: true });
  });

  it('disconnects at expiry and rejects subscriptions after expiry', async () => {
    const client = await accepted(sign('fleet-a', 1));
    vi.advanceTimersByTime(1000);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    await subscribe('fleet-a');
    expect(client.join).not.toHaveBeenCalled();
  });

  it('removes the expiry timer and the session re-check when the socket disconnects', async () => {
    const client = await accepted(sign());
    handlers.get('disconnect')!();
    db.row = null; // even a deleted account must not trigger a disconnect now
    cacheExpires();
    await vi.advanceTimersByTimeAsync(SOCKET_RECHECK_MS * 3);
    expect(client.disconnect).not.toHaveBeenCalled();
  });
});

// Review item #5: the fleet and the session come from the database, not from
// what the token said at login.
describe('fleet sockets follow the live session', () => {
  it('refuses a user who has no fleet now, whatever the token says', async () => {
    db.row = { ...db.row, fleetId: null };
    await rejected(sign('fleet-a'));
  });

  it('refuses a revoked session and a deleted account at the handshake', async () => {
    db.row = { ...db.row, tokensValidAfter: new Date(Date.now() + 2000) };
    await rejected(sign());
    clearSessionCache();
    db.row = null;
    await rejected(sign());
  });

  it('subscribes to the live fleet, not the one copied into the token', async () => {
    db.row = { ...db.row, fleetId: 'fleet-b' };
    const client = await accepted(sign('fleet-a'));
    const acknowledge = vi.fn();
    await subscribe('fleet-a', acknowledge);
    expect(acknowledge).toHaveBeenLastCalledWith({ ok: false });
    await subscribe('fleet-b', acknowledge);
    expect(acknowledge).toHaveBeenLastCalledWith({ ok: true });
    expect(client.join).toHaveBeenCalledExactlyOnceWith('fleet:fleet-b');
  });

  it('disconnects an open socket at the next re-check after a revoke', async () => {
    const client = await accepted(sign());
    await subscribe('fleet-a');

    db.row = { ...db.row, tokensValidAfter: new Date(Date.now() + 2000) };
    cacheExpires();
    await vi.advanceTimersByTimeAsync(SOCKET_RECHECK_MS);

    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('moves a connected socket out of its old fleet room when the user changes fleet', async () => {
    const client = await accepted(sign());
    await subscribe('fleet-a');
    expect(client.join).toHaveBeenCalledWith('fleet:fleet-a');

    db.row = { ...db.row, fleetId: 'fleet-b' };
    cacheExpires();
    await vi.advanceTimersByTimeAsync(SOCKET_RECHECK_MS);

    expect(client.leave).toHaveBeenCalledWith('fleet:fleet-a');
    expect(client.disconnect).not.toHaveBeenCalled();
    const acknowledge = vi.fn();
    await subscribe('fleet-a', acknowledge);
    expect(acknowledge).toHaveBeenLastCalledWith({ ok: false });
  });

  it('refuses a subscription once the session is revoked, without waiting for the re-check', async () => {
    const client = await accepted(sign());
    db.row = null;
    cacheExpires();
    const acknowledge = vi.fn();
    await subscribe('fleet-a', acknowledge);
    expect(acknowledge).toHaveBeenLastCalledWith({ ok: false });
    expect(client.join).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });
});
