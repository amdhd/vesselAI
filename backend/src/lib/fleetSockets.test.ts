import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Server, Socket } from 'socket.io';
import { registerFleetSockets } from './fleetSockets';
import { JWT_SECRET } from './jwtConfig';

type Next = (error?: Error) => void;
let authorize: (socket: Socket, next: Next) => void;
let connect: (socket: Socket) => void;
const handlers = new Map<string, (...args: any[]) => void>();

function socket(token: unknown) {
  return {
    id: 'dummy-socket', handshake: { auth: { token } }, data: {},
    join: vi.fn(), disconnect: vi.fn(),
    on: vi.fn((event, handler) => { handlers.set(event, handler); }),
  } as unknown as Socket;
}
function sign(fleetId: unknown = 'fleet-a', expiresIn = 60) {
  return jwt.sign({ id: 'dummy-user', fleetId }, JWT_SECRET, { expiresIn });
}
function accepted(token: string) {
  const client = socket(token);
  const next = vi.fn();
  authorize(client, next);
  expect(next).toHaveBeenCalledWith();
  connect(client);
  return client;
}

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
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
  it.each([undefined, { token: 'wrong shape' }, 'invalid-token'])('rejects missing or malformed credentials: %j', (token) => {
    const next = vi.fn();
    authorize(socket(token), next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('rejects wrong signatures, expired tokens and fleetless or unbounded identities', () => {
    for (const token of [
      jwt.sign({ id: 'dummy-user', fleetId: 'fleet-a' }, 'a-different-dummy-secret', { expiresIn: 60 }),
      sign('fleet-a', -1), sign(null),
      jwt.sign({ id: 'dummy-user', fleetId: 'fleet-a' }, JWT_SECRET),
      jwt.sign({ fleetId: 'fleet-a' }, JWT_SECRET, { expiresIn: 60 }),
    ]) {
      const next = vi.fn();
      authorize(socket(token), next);
      expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    }
  });

  it('joins only the authenticated fleet and refuses forged room selectors', () => {
    const client = accepted(sign());
    const acknowledge = vi.fn();
    handlers.get('subscribe:fleet')!('fleet-b', acknowledge);
    handlers.get('subscribe:fleet')!({ fleetId: 'fleet-a' }, acknowledge);
    expect(client.join).not.toHaveBeenCalled();
    expect(acknowledge).toHaveBeenCalledWith({ ok: false });
    handlers.get('subscribe:fleet')!('fleet-a', acknowledge);
    expect(client.join).toHaveBeenCalledExactlyOnceWith('fleet:fleet-a');
    expect(acknowledge).toHaveBeenLastCalledWith({ ok: true });
  });

  it('disconnects at expiry and rejects subscriptions after expiry', () => {
    const client = accepted(sign('fleet-a', 1));
    vi.advanceTimersByTime(1000);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    handlers.get('subscribe:fleet')!('fleet-a');
    expect(client.join).not.toHaveBeenCalled();
  });

  it('removes the expiry timer when the socket disconnects', () => {
    const client = accepted(sign());
    handlers.get('disconnect')!();
    vi.advanceTimersByTime(60_000);
    expect(client.disconnect).not.toHaveBeenCalled();
  });
});
