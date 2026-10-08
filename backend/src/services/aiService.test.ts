import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import type { Response } from 'express';
import { generateJson, anthropic } from './aiService';

// These tests never reach the network: the SDK client is real (so the code path
// under test is the shipped one) but its `create` call is replaced with a stub
// returning a canned reply — the same trick the route tests use to avoid
// billing a live model call just to check a fallback branch.

const ReplySchema = z.object({
  subject: z.string(),
  body: z.string(),
});

const FALLBACK = { subject: 'canned subject', body: 'canned body' };

// generateJson touches only `setHeader` on the response, so a two-line stand-in
// is enough to observe which path a reply took.
function fakeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    res: {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    } as unknown as Response,
  };
}

function modelRepliesWith(text: string) {
  return vi
    .spyOn(anthropic.messages, 'create')
    .mockResolvedValue({ content: [{ type: 'text', text }], usage: {} } as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateJson response validation', () => {
  it('returns the model reply as parsed data when it matches the schema', async () => {
    modelRepliesWith(JSON.stringify({ subject: 'Real', body: 'From the model' }));
    const { res, headers } = fakeRes();

    const result = await generateJson(res, {
      system: 's',
      prompt: 'p',
      schema: ReplySchema,
      fallback: FALLBACK,
    });

    expect(result).toEqual({ subject: 'Real', body: 'From the model' });
    expect(headers['X-AI-Fallback']).toBeUndefined();
  });

  it('accepts a reply wrapped in markdown fences', async () => {
    modelRepliesWith('```json\n{"subject":"Real","body":"Fenced"}\n```');
    const { res, headers } = fakeRes();

    const result = await generateJson(res, {
      system: 's',
      prompt: 'p',
      schema: ReplySchema,
      fallback: FALLBACK,
    });

    expect(result).toEqual({ subject: 'Real', body: 'Fenced' });
    expect(headers['X-AI-Fallback']).toBeUndefined();
  });

  it('falls back when the reply is missing a field the caller reads', async () => {
    // The regression: this used to be cast `as T` and returned, so `body` went
    // out as undefined and the UI rendered an empty message as a real one.
    modelRepliesWith(JSON.stringify({ subject: 'Real' }));
    const { res, headers } = fakeRes();
    const onError = vi.fn();

    const result = await generateJson(res, {
      system: 's',
      prompt: 'p',
      schema: ReplySchema,
      fallback: FALLBACK,
      onError,
    });

    expect(result).toEqual(FALLBACK);
    expect(headers['X-AI-Fallback']).toBe('true');
    // A shape mismatch is not throttling — it must not be reported as such.
    expect(headers['X-AI-Rate-Limited']).toBeUndefined();
    // The log has to name the offending field, or an operator cannot tell a
    // model that forgot a key from an API key that expired.
    expect(String(onError.mock.calls[0][0])).toMatch(/body/);
  });

  it('falls back when a field has the wrong type instead of coercing it', async () => {
    modelRepliesWith(JSON.stringify({ subject: 'Real', body: 42 }));
    const { res, headers } = fakeRes();

    const result = await generateJson(res, {
      system: 's',
      prompt: 'p',
      schema: ReplySchema,
      fallback: FALLBACK,
    });

    expect(result).toEqual(FALLBACK);
    expect(headers['X-AI-Fallback']).toBe('true');
  });

  it('drops fields the model invented rather than failing the reply', async () => {
    // The model's output is untrusted: an extra key must not reach the response
    // body, but it is not worth discarding a good answer over either.
    modelRepliesWith(JSON.stringify({ subject: 'Real', body: 'Kept', injected: 'drop me' }));
    const { res, headers } = fakeRes();

    const result = await generateJson(res, {
      system: 's',
      prompt: 'p',
      schema: ReplySchema,
      fallback: FALLBACK,
    });

    expect(result).toEqual({ subject: 'Real', body: 'Kept' });
    expect(headers['X-AI-Fallback']).toBeUndefined();
  });

  it('falls back when the reply is not JSON at all', async () => {
    modelRepliesWith('I am sorry, I cannot help with that.');
    const { res, headers } = fakeRes();

    const result = await generateJson(res, {
      system: 's',
      prompt: 'p',
      schema: ReplySchema,
      fallback: FALLBACK,
    });

    expect(result).toEqual(FALLBACK);
    expect(headers['X-AI-Fallback']).toBe('true');
  });
});
