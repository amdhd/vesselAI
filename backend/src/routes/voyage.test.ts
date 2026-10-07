import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

// Stub the AI service before the app is imported.
//
// Every voyage handler ends in a generateJson() call, and the test run has a
// real ANTHROPIC_API_KEY available (src/app.ts imports dotenv/config, so .env
// is loaded). Without this stub, asserting a 404 — a path that returns before
// any model call — would still be one of the few that doesn't spend, but the
// "no voyageId" case below would bill a live call. The stub returns the
// handler's own deterministic fallback, which is the thing under test anyway:
// these tests are about *which voyage* the handler picked, not about the model.
vi.mock('../services/aiService', () => ({
  AI_MODEL: 'stub-model',
  anthropic: {},
  stripJsonFences: (text: string) => text,
  generateJson: async (_res: unknown, params: { fallback: unknown }) => params.fallback,
  streamChatResponse: async () => {},
}));

import { createApp } from '../app';

const app = createApp();

// The fleet has three active voyages, all in fleet-001 (the demo user's fleet):
//   v-001-20  vessel-001  departs Port Dickson,         282000 MT
//   v-002-20  vessel-002  departs Singapore,            109000 MT
//   v-003-20  vessel-003  departs Kerteh Marine Terminal, 3200 MT
// v-001-20 is first, so it is what the old `.find(matching) || .find(any)`
// fallback silently substituted for any unrecognised voyageId.
const FIRST_ACTIVE_VOYAGE_PORT = 'Port Dickson';
const SECOND_ACTIVE_VOYAGE = { id: 'v-002-20', vesselId: 'vessel-002', port: 'Singapore', cargo: 109000 };

async function demoToken(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'demo@petronas.com', password: 'demo123' });
  return res.body.token as string;
}

describe('POST /api/voyage/predict-eta — voyage resolution', () => {
  it('404s for a voyageId that matches no voyage, rather than pricing a different one', async () => {
    const token = await demoToken();
    const res = await request(app)
      .post('/api/voyage/predict-eta')
      .set('Authorization', `Bearer ${token}`)
      .send({ vesselId: 'vessel-001', voyageId: 'v-no-such-voyage' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/voyage not found/i);
  });

  it('still defaults to the fleet active voyage when no voyageId is supplied', async () => {
    // Omitting voyageId is a legitimate request for "this fleet's active
    // voyage" and must keep working — the 404 above must not swallow it.
    const token = await demoToken();
    const res = await request(app)
      .post('/api/voyage/predict-eta')
      .set('Authorization', `Bearer ${token}`)
      .send({ vesselId: 'vessel-001' });

    expect(res.status).toBe(200);
    expect(res.body.basicEta).toBeTruthy();
    expect(res.body.aiEta).toBeTruthy();
  });
});

describe('POST /api/voyage/generate-agent-message — voyage resolution', () => {
  it('404s for a voyageId that matches no voyage', async () => {
    const token = await demoToken();
    const res = await request(app)
      .post('/api/voyage/generate-agent-message')
      .set('Authorization', `Bearer ${token}`)
      .send({ vesselId: 'vessel-001', voyageId: 'v-no-such-voyage', portName: 'Fujairah' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/voyage not found/i);
  });

  it('drafts the letter for the voyage that was actually named', async () => {
    // The letter embeds the voyage's departure port and cargo, so it is the
    // place the substitution was visible: a letter for v-002-20 used to be
    // able to carry v-001-20's port and tonnage. Before the fix, asking for an
    // unknown voyage returned FIRST_ACTIVE_VOYAGE_PORT's figures instead.
    const token = await demoToken();
    const res = await request(app)
      .post('/api/voyage/generate-agent-message')
      .set('Authorization', `Bearer ${token}`)
      .send({
        vesselId: SECOND_ACTIVE_VOYAGE.vesselId,
        voyageId: SECOND_ACTIVE_VOYAGE.id,
        portName: 'Fujairah',
      });

    expect(res.status).toBe(200);
    expect(res.body.body).toContain(SECOND_ACTIVE_VOYAGE.port);
    expect(res.body.body).toContain(String(SECOND_ACTIVE_VOYAGE.cargo));
    expect(res.body.body).not.toContain(FIRST_ACTIVE_VOYAGE_PORT);
  });

  it('does not substitute the first active voyage for an unknown id', async () => {
    // The regression itself, stated directly: whatever comes back for an
    // unknown voyage must not be the first active voyage's numbers.
    const token = await demoToken();
    const res = await request(app)
      .post('/api/voyage/generate-agent-message')
      .set('Authorization', `Bearer ${token}`)
      .send({ vesselId: 'vessel-001', voyageId: 'v-no-such-voyage', portName: 'Fujairah' });

    expect(res.body.body).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(FIRST_ACTIVE_VOYAGE_PORT);
  });
});
