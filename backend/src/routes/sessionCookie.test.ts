import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Production is toggled to check the Secure flag. No database: login takes the
// demo path (NODE_ENV=test, so demo login is on) and the auth gate trusts the
// signed claims outside production, as it does in demo mode.
const flags = vi.hoisted(() => ({ production: false }));
vi.mock('../config/env', async (importOriginal) => {
  const real = await importOriginal<typeof import('../config/env')>();
  return { ...real, get isProduction() { return flags.production; } };
});

import { createApp } from '../app';
import { SESSION_COOKIE, WEB_CLIENT_HEADER, WEB_CLIENT_VALUE } from '../lib/sessionCookie';

const app = createApp();
const DEMO = { email: 'demo@petronas.com', password: 'demo123' };
const WEB = { [WEB_CLIENT_HEADER]: WEB_CLIENT_VALUE };

beforeEach(() => {
  flags.production = false;
});

/** The Set-Cookie line for the session cookie, if the response set one. */
function sessionSetCookie(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const lines = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return lines.find((line) => line.startsWith(`${SESSION_COOKIE}=`));
}
/** "vm_session=<value>", ready to send back as a Cookie header. */
const cookiePair = (setCookie: string) => setCookie.split(';')[0];

async function webLogin() {
  const res = await request(app).post('/api/auth/login').set(WEB).send(DEMO);
  return { res, cookie: cookiePair(sessionSetCookie(res)!) };
}

describe('login: who gets a cookie', () => {
  it('the web app gets an httpOnly, SameSite=Strict cookie and NO token in the body', async () => {
    const { res } = await webLogin();
    expect(res.status).toBe(200);
    expect(res.body.token).toBeUndefined(); // no script on the page ever holds it
    expect(res.body.user).toMatchObject({ email: DEMO.email });
    const setCookie = sessionSetCookie(res)!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).toMatch(/Max-Age=\d+/);
    expect(setCookie).not.toMatch(/Secure/); // plain-http development
  });

  it('marks the cookie Secure in production', async () => {
    flags.production = true;
    const { res } = await webLogin();
    expect(sessionSetCookie(res)).toMatch(/Secure/);
  });

  it('other clients (Angular, API clients) still get the token in the body and no cookie', async () => {
    const res = await request(app).post('/api/auth/login').send(DEMO);
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(sessionSetCookie(res)).toBeUndefined();
  });

  it('a cross-site form login (login CSRF) never gets a cookie set', async () => {
    // A form on another site can post credentials as form-encoded data, which
    // the backend parses, but it cannot add the web client header.
    const res = await request(app)
      .post('/api/auth/login')
      .type('form')
      .send(DEMO);
    expect(sessionSetCookie(res)).toBeUndefined();
  });
});

describe('using the cookie', () => {
  it('authenticates reads from the cookie alone', async () => {
    const { cookie } = await webLogin();
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: DEMO.email });
  });

  it('refuses a state-changing request on the cookie without the web client header (CSRF)', async () => {
    const { cookie } = await webLogin();
    const forged = await request(app).post('/api/auth/analytics-token').set('Cookie', cookie);
    expect(forged.status).toBe(403);
    expect(forged.body).toEqual({ error: 'Missing client header' });

    const genuine = await request(app).post('/api/auth/analytics-token').set('Cookie', cookie).set(WEB);
    expect(genuine.status).toBe(200);
  });

  it('a bearer header wins, and a bad one is refused rather than falling back to the cookie', async () => {
    const { cookie } = await webLogin();
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('no cookie and no header is still a 401', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });
});

describe('logout', () => {
  it('clears the cookie for the web app', async () => {
    const res = await request(app).post('/api/auth/logout').set(WEB);
    expect(res.status).toBe(204);
    const cleared = sessionSetCookie(res)!;
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(cleared).toMatch(/HttpOnly/);
  });

  it('refuses without the web client header, so another site cannot sign users out', async () => {
    expect((await request(app).post('/api/auth/logout')).status).toBe(403);
  });
});
