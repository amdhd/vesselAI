import Anthropic from '@anthropic-ai/sdk';
import { Response } from 'express';
import { logger } from '../lib/logger';
import { aiRequestsTotal } from '../lib/metrics';

export const AI_MODEL = 'claude-sonnet-4-6';

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** Strip markdown code fences models sometimes wrap JSON responses in. */
export function stripJsonFences(text: string): string {
  return text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
}

/**
 * Pull the `retry-after` value (seconds) off an Anthropic error. The SDK may
 * expose headers as a `Headers` object (with `.get`) or a plain record
 * depending on version, so probe both shapes.
 */
function extractRetryAfter(error: unknown): string | undefined {
  const headers = (error as { headers?: unknown })?.headers;
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get('retry-after') ?? undefined;
  }
  const val = (headers as Record<string, string>)['retry-after'];
  return val ?? undefined;
}

interface AiUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/**
 * Emit a structured per-call token-usage line so ITPM/OTPM headroom and cost
 * are observable in logs. `usage` is undefined when the call failed before a
 * response (e.g. a rate-limit error) — nothing to log in that case.
 */
function logUsage(label: string, usage?: AiUsage | null): void {
  aiRequestsTotal.inc({ label, outcome: 'success' });
  if (!usage) return;
  logger.info(
    {
      label,
      model: AI_MODEL,
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    },
    'ai usage'
  );
}

/**
 * Distinguish an Anthropic 429 (rate limit / TPM exhaustion, retryable) from
 * other failures so throttling is visible in logs rather than silently
 * collapsing into the generic fallback. Returns whether the error was a rate
 * limit and its `retry-after` hint.
 */
function classifyAiError(label: string, error: unknown): { rateLimited: boolean; retryAfter?: string } {
  if (error instanceof Anthropic.RateLimitError) {
    const retryAfter = extractRetryAfter(error);
    aiRequestsTotal.inc({ label, outcome: 'rate_limited' });
    logger.warn({ label, model: AI_MODEL, status: error.status, retryAfter: retryAfter ?? null }, 'ai rate-limited');
    return { rateLimited: true, retryAfter };
  }
  aiRequestsTotal.inc({ label, outcome: 'error' });
  logger.error({ err: error, label }, 'ai error');
  return { rateLimited: false };
}

/**
 * Call Claude for a single structured JSON response. On any failure (bad key,
 * rate limit, malformed output) falls back to `fallback` so the route still
 * returns a usable payload instead of a 500 — and marks the response with an
 * `X-AI-Fallback` header so a caller (or monitoring) can tell canned data
 * from a real model response instead of the two being indistinguishable.
 *
 * A rate-limit (429) additionally sets `X-AI-Rate-Limited: true` and echoes the
 * upstream `Retry-After` header, so clients can back off and dashboards can
 * distinguish throttling from real model errors. Token usage of successful
 * calls is logged for ITPM/OTPM/cost visibility.
 */
export async function generateJson<T>(
  res: Response,
  params: {
    system: string;
    prompt: string;
    maxTokens?: number;
    fallback: T;
    label?: string;
    onError?: (error: unknown) => void;
  }
): Promise<T> {
  const label = params.label ?? 'generateJson';
  try {
    const message = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: params.maxTokens ?? 1500,
      system: params.system,
      messages: [{ role: 'user', content: params.prompt }],
    });
    logUsage(label, message.usage);
    const rawContent = message.content[0].type === 'text' ? message.content[0].text : '';
    return JSON.parse(stripJsonFences(rawContent)) as T;
  } catch (error) {
    params.onError?.(error);
    const { rateLimited, retryAfter } = classifyAiError(label, error);
    res.setHeader('X-AI-Fallback', 'true');
    if (rateLimited) {
      res.setHeader('X-AI-Rate-Limited', 'true');
      if (retryAfter) res.setHeader('Retry-After', retryAfter);
    }
    return params.fallback;
  }
}

/**
 * Stream a Claude chat completion to the client over SSE. On failure, writes
 * a single fallback message chunk (flagged with `aiFallback: true` so the
 * frontend/observability can distinguish it from a real streamed reply)
 * instead of dropping the connection. A rate-limit (429) additionally sets
 * `rateLimited: true` (and `retryAfter` when known) on the chunk — HTTP headers
 * are already flushed by the time streaming errors, so the signal rides in the
 * SSE body. Token usage of successful streams is logged.
 */
export async function streamChatResponse(
  res: Response,
  params: {
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    maxTokens?: number;
    fallbackText: string;
    label?: string;
    onError?: (error: unknown) => void;
  }
): Promise<void> {
  const label = params.label ?? 'streamChatResponse';
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = anthropic.messages.stream({
      model: AI_MODEL,
      max_tokens: params.maxTokens ?? 2048,
      system: params.system,
      messages: params.messages,
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }

    logUsage(label, (await stream.finalMessage()).usage);
  } catch (error) {
    params.onError?.(error);
    const { rateLimited, retryAfter } = classifyAiError(label, error);
    res.write(
      `data: ${JSON.stringify({ text: params.fallbackText, aiFallback: true, rateLimited, retryAfter })}\n\n`
    );
  }

  res.write('data: [DONE]\n\n');
  res.end();
}
