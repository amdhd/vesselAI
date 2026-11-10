import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';
import { logger } from './logger';

/**
 * A rate-limit store that counts in a SHARED primary (Redis) and falls back to
 * a per-pod store when the primary is unavailable.
 *
 * WHY SHARED. express-rate-limit's default store is in-process memory, so each
 * API replica keeps its own counters. With the HPA running 2–8 replicas, the
 * login brute-force limit of 5 failures per 15 minutes was really 10–40, and the
 * AI cost limit of 10 a minute per user was really 20–80 — and both loosened
 * exactly when load scaled the deployment out. A store every replica shares
 * makes the configured number the real one.
 *
 * WHY A FALLBACK. If the shared store is down and the limiter can't count, it
 * has two bad options: fail every request (an outage of Redis becomes an
 * outage of login), or skip the limit (an outage of Redis switches brute-force
 * protection off). Neither is acceptable for a security control, so this does
 * a third thing: it keeps counting, per pod, in the fallback. Limits degrade to
 * what they were before a shared store existed — never to none — and recover
 * on their own when the primary answers again.
 *
 * A SLOW primary counts as a down one. A hung connection would otherwise hang
 * every request behind the limiter, so each primary call is bounded by
 * `timeoutMs`.
 *
 * Known imprecision, accepted: a hit counted in the fallback during an outage
 * is not in Redis afterwards, and a decrement (authLimiter's
 * skipSuccessfulRequests) can land in a different store from its increment
 * across the switch. At worst a client is off by a hit or two around an
 * outage, in either direction.
 */
export class FallbackStore implements Store {
  /** Counts are shared across replicas whenever the primary is up. */
  localKeys = false;
  prefix?: string;

  private lastWarnAt = 0;

  constructor(
    private readonly primary: Store,
    private readonly fallback: Store,
    private readonly options: { timeoutMs?: number; name?: string } = {}
  ) {
    this.prefix = primary.prefix;
  }

  async init(options: Options): Promise<void> {
    // Both are initialised. A primary that cannot initialise (Redis down at
    // boot) must not stop the fallback from working, and the Redis store
    // retries its own setup on the next call, so the failure is logged, not
    // thrown.
    await this.fallback.init?.(options);
    try {
      await this.withTimeout(Promise.resolve(this.primary.init?.(options)));
    } catch (err) {
      this.warn('init', err);
    }
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    try {
      return await this.withTimeout(Promise.resolve(this.primary.increment(key)));
    } catch (err) {
      this.warn('increment', err);
      return this.fallback.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.withTimeout(Promise.resolve(this.primary.decrement(key)));
    } catch (err) {
      this.warn('decrement', err);
      await this.fallback.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    // Clear both: a reset must not leave a count behind in either store.
    await Promise.allSettled([
      this.withTimeout(Promise.resolve(this.primary.resetKey(key))),
      Promise.resolve(this.fallback.resetKey(key)),
    ]);
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    try {
      return await this.withTimeout(Promise.resolve(this.primary.get?.(key)));
    } catch (err) {
      this.warn('get', err);
      return this.fallback.get?.(key);
    }
  }

  private withTimeout<T>(work: Promise<T>): Promise<T> {
    const ms = this.options.timeoutMs ?? 250;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`rate-limit store did not answer within ${ms}ms`)), ms);
      timer.unref?.();
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }

  // At most one warning per store per 30s: an outage hits every request, and a
  // log line per request would bury everything else.
  private warn(operation: string, err: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt < 30_000) return;
    this.lastWarnAt = now;
    logger.warn(
      { err, store: this.options.name, operation },
      'shared rate-limit store unavailable — counting per pod until it recovers'
    );
  }
}
