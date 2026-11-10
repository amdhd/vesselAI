import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import rateLimit, { MemoryStore, type ClientRateLimitInfo, type Options, type Store } from 'express-rate-limit';
import { FallbackStore } from './fallbackStore';

/**
 * Stand-in for Redis: one counter table that every "replica" talks to. It can
 * be switched to failing or hanging to model an outage. (There is no Redis in
 * CI or here; the RedisStore adapter itself is the library's, and this tests
 * what the app adds around it.)
 */
class SharedCounter implements Store {
  mode: 'up' | 'down' | 'hang' = 'up';
  hits = new Map<string, number>();
  private windowMs = 60_000;
  init(options: Options) {
    this.windowMs = options.windowMs;
  }
  private check() {
    if (this.mode === 'down') throw new Error('ECONNREFUSED');
    if (this.mode === 'hang') return new Promise<never>(() => {});
    return undefined;
  }
  async increment(key: string): Promise<ClientRateLimitInfo> {
    await this.check();
    const totalHits = (this.hits.get(key) ?? 0) + 1;
    this.hits.set(key, totalHits);
    return { totalHits, resetTime: new Date(Date.now() + this.windowMs) };
  }
  async decrement(key: string) {
    await this.check();
    this.hits.set(key, Math.max(0, (this.hits.get(key) ?? 0) - 1));
  }
  async resetKey(key: string) {
    await this.check();
    this.hits.delete(key);
  }
  async get(key: string) {
    await this.check();
    const totalHits = this.hits.get(key);
    return totalHits === undefined ? undefined : { totalHits, resetTime: undefined };
  }
}

/** One API replica: its own limiter instance, as each pod builds at import. */
function replica(store: Store, max = 5) {
  const app = express();
  app.use(rateLimit({ windowMs: 60_000, max, store, standardHeaders: true, legacyHeaders: false, keyGenerator: () => 'client' }));
  app.get('/', (_req, res) => { res.json({ ok: true }); });
  return app;
}

const hit = (app: express.Express) => request(app).get('/');

describe('rate limits across replicas', () => {
  it('per-pod memory (the old behaviour): two replicas allow twice the limit', async () => {
    const podA = replica(new MemoryStore());
    const podB = replica(new MemoryStore());
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await hit(podA)).status, (await hit(podB)).status);
    // 10 requests against a limit of 5, all allowed: the bug #6 is about.
    expect(statuses.filter((s) => s === 200)).toHaveLength(10);
  });

  it('a shared store: two replicas together allow exactly the limit', async () => {
    const shared = new SharedCounter();
    const podA = replica(new FallbackStore(shared, new MemoryStore()));
    const podB = replica(new FallbackStore(shared, new MemoryStore()));
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await hit(podA)).status, (await hit(podB)).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
  });
});

describe('when the shared store is unavailable', () => {
  it('keeps limiting per pod: never unlimited, never a 500', async () => {
    const shared = new SharedCounter();
    shared.mode = 'down';
    const pod = replica(new FallbackStore(shared, new MemoryStore()));
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await hit(pod)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429]);
  });

  it('treats a hung connection as down instead of hanging the request', async () => {
    const shared = new SharedCounter();
    shared.mode = 'hang';
    const pod = replica(new FallbackStore(shared, new MemoryStore(), { timeoutMs: 20 }));
    const started = Date.now();
    expect((await hit(pod)).status).toBe(200);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('goes back to the shared count when the store recovers', async () => {
    const shared = new SharedCounter();
    const store = new FallbackStore(shared, new MemoryStore());
    const pod = replica(store);
    shared.mode = 'down';
    await hit(pod);
    shared.mode = 'up';
    await hit(pod);
    expect(shared.hits.get('client')).toBe(1); // the post-recovery hit landed in the shared store
  });

  it('does not fail initialisation when the shared store is down at boot', async () => {
    const primary: Store = {
      init: vi.fn(async () => { throw new Error('ECONNREFUSED'); }),
      increment: vi.fn(async () => { throw new Error('ECONNREFUSED'); }),
      decrement: vi.fn(),
      resetKey: vi.fn(),
    };
    const store = new FallbackStore(primary, new MemoryStore());
    await expect(store.init({ windowMs: 60_000 } as Options)).resolves.toBeUndefined();
    expect((await store.increment('k')).totalHits).toBe(1);
  });

  it('a reset clears the key in both stores', async () => {
    const shared = new SharedCounter();
    const fallback = new MemoryStore();
    const store = new FallbackStore(shared, fallback);
    await store.init({ windowMs: 60_000 } as Options);
    shared.mode = 'down';
    await store.increment('k'); // counted in the fallback
    shared.mode = 'up';
    await store.increment('k'); // counted in the shared store
    await store.resetKey('k');
    expect(shared.hits.has('k')).toBe(false);
    expect(await fallback.get('k')).toBeUndefined();
  });
});
