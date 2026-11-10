import { createClient } from 'redis';
import { env } from '../config/env';
import { logger } from './logger';

// One Redis connection for the process, created on first use and only when
// REDIS_URL is set. Today its only user is the shared rate-limit store
// (lib/fallbackStore.ts); without REDIS_URL the limiters keep their per-pod
// memory store, which is fine for local development and a single replica.

type Client = ReturnType<typeof createClient>;
let client: Client | null = null;
let lastErrorLogAt = 0;

export function getRedisClient(): Client | null {
  if (!env.REDIS_URL) return null;
  if (client) return client;

  client = createClient({
    url: env.REDIS_URL,
    // Fail commands immediately while disconnected instead of queueing them
    // until the connection returns. A queued command is a request waiting on
    // Redis; failing fast is what lets FallbackStore switch to per-pod counts
    // straight away.
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 2_000,
      // Keep trying, backing off to every 5s: the fallback covers the gap, and
      // the shared limits come back on their own when Redis does.
      reconnectStrategy: (retries: number) => Math.min(250 * 2 ** retries, 5_000),
    },
  });
  client.on('error', (err) => {
    // node-redis emits on every failed reconnect attempt; one line per 30s.
    const now = Date.now();
    if (now - lastErrorLogAt < 30_000) return;
    lastErrorLogAt = now;
    logger.warn({ err }, 'redis connection error');
  });
  client.connect().catch((err) => logger.warn({ err }, 'redis initial connect failed; will keep retrying'));
  return client;
}

/** Close the connection during graceful shutdown. Safe to call when never opened. */
export async function closeRedis(): Promise<void> {
  if (!client) return;
  const closing = client;
  client = null;
  try {
    await closing.close();
  } catch {
    closing.destroy();
  }
}
