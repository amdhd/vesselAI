import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { anthropic } from '../services/aiService';

// generateJson's own tests cover the validation. These cover the wiring: that a
// route actually hands its schema to the model call, and that a reply the route
// cannot use reaches the client as the route's fallback with the X-AI-Fallback
// header, rather than as a response with the fields silently missing.
//
// The SDK client is real — the shipped generateJson runs end to end — but its
// create call is stubbed, so no request is billed. `predict-eta` is the route
// under test because it returns the model's object as the entire response body,
// which is where an unvalidated reply was most visible.

const app = createApp();

function modelRepliesWith(text: string) {
  vi.spyOn(anthropic.messages, 'create').mockResolvedValue({
    content: [{ type: 'text', text }],
    usage: {},
  } as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function demoToken(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'demo@petronas.com', password: 'demo123' });
  return res.body.token as string;
}

describe('POST /api/voyage/predict-eta (model reply validation)', () => {
  it('serves the fallback, flagged, when the reply is missing required fields', async () => {
    modelRepliesWith(JSON.stringify({ confidence: 'high' }));
    const token = await demoToken();

    const res = await request(app)
      .post('/api/voyage/predict-eta')
      .set('Authorization', `Bearer ${token}`)
      .send({ vesselId: 'vessel-001' });

    expect(res.status).toBe(200);
    expect(res.headers['x-ai-fallback']).toBe('true');
    // Before validation this body was `{ confidence: 'high' }`: no ETA at all,
    // and the frontend rendered the missing fields as an empty card.
    expect(typeof res.body.basicEta).toBe('string');
    expect(typeof res.body.aiEta).toBe('string');
    expect(Array.isArray(res.body.factors)).toBe(true);
  });

  it('serves the model reply unmarked when it matches the contract', async () => {
    modelRepliesWith(
      JSON.stringify({
        basicEta: new Date(Date.now() + 3_600_000).toISOString(),
        aiEta: new Date(Date.now() + 7_200_000).toISOString(),
        confidence: 91,
        factors: ['calm seas ahead'],
        recommendation: 'Hold speed for the berth window.',
      })
    );
    const token = await demoToken();

    const res = await request(app)
      .post('/api/voyage/predict-eta')
      .set('Authorization', `Bearer ${token}`)
      .send({ vesselId: 'vessel-001' });

    expect(res.status).toBe(200);
    expect(res.headers['x-ai-fallback']).toBeUndefined();
    expect(res.body.confidence).toBe(91);
    expect(res.body.factors).toEqual(['calm seas ahead']);
  });
});
