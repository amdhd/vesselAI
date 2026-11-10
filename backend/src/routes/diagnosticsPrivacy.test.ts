import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../lib/prisma', () => ({ prisma: {} }));
import { bearerMatches, createApp } from '../app';
import { env } from '../config/env';
import { registry } from '../lib/metrics';
import { createError, errorHandler } from '../middleware/errorHandler';

const initialEnv = { node: env.NODE_ENV, token: env.METRICS_TOKEN };
afterEach(() => {
  env.NODE_ENV = initialEnv.node;
  env.METRICS_TOKEN = initialEnv.token;
});

describe('private diagnostics', () => {
  it('disables production metrics without a token and rejects missing or wrong credentials once configured', async () => {
    const app = createApp();
    env.NODE_ENV = 'production';
    env.METRICS_TOKEN = undefined;
    expect((await request(app).get('/metrics')).status).toBe(404);
    env.METRICS_TOKEN = 'dummy-scrape-token';
    expect((await request(app).get('/metrics')).status).toBe(401);
    expect((await request(app).get('/metrics').set('Authorization', 'Bearer wrong')).status).toBe(401);
    // Near misses: the cases a character-by-character compare is fastest to
    // reject, and so the ones a timing attack learns from. All must still fail.
    for (const near of [
      'Bearer dummy-scrape-tokeN',   // same length, last character off
      'Bearer dummy-scrape',         // a prefix
      'Bearer dummy-scrape-token2',  // the token plus one character
      'dummy-scrape-token',          // right token, no scheme
      'Basic dummy-scrape-token',    // right token, wrong scheme
    ]) {
      expect((await request(app).get('/metrics').set('Authorization', near)).status).toBe(401);
    }
    const allowed = await request(app).get('/metrics').set('Authorization', 'Bearer dummy-scrape-token');
    expect(allowed.status).toBe(200);
    expect(allowed.text).toContain('http_request_duration_seconds');
    expect(allowed.text).not.toContain('dummy-scrape-token');
  });

  it('does not put private unknown paths into metric labels or 404 responses', async () => {
    const app = createApp();
    const response = await request(app).get('/api/private-DUMMY_SECRET?access_token=DUMMY_SECRET');
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('DUMMY_SECRET');
    const metrics = await registry.metrics();
    expect(metrics).not.toContain('DUMMY_SECRET');
    expect(metrics).toContain('route="unmatched"');
  });

  it.each([400, 500])('does not expose exception content in client errors (%i)', async (status) => {
    const app = express();
    app.get('/', (_req, _res, next) => next(Object.assign(createError('DUMMY_SECRET', status), {
      details: { token: 'DUMMY_SECRET' }, stack: 'DUMMY_SECRET',
    })));
    app.use(errorHandler);
    const res = await request(app).get('/');
    expect(res.status).toBe(status);
    expect(JSON.stringify(res.body)).not.toContain('DUMMY_SECRET');
    expect(res.body.stack).toBeUndefined();
    expect(res.body.details).toBeUndefined();
  });
});

describe('bearerMatches', () => {
  it('accepts only the exact header, and never throws on a length mismatch', () => {
    // timingSafeEqual throws on unequal-length buffers; hashing first is what
    // makes a short or long guess a plain false instead of an exception.
    expect(bearerMatches('Bearer t0ken', 't0ken')).toBe(true);
    expect(bearerMatches(undefined, 't0ken')).toBe(false);
    expect(bearerMatches('', 't0ken')).toBe(false);
    expect(bearerMatches('Bearer t0ke', 't0ken')).toBe(false);
    expect(bearerMatches(`Bearer ${'x'.repeat(10_000)}`, 't0ken')).toBe(false);
  });
});
