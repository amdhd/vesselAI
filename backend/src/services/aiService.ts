import Anthropic from '@anthropic-ai/sdk';
import { Response } from 'express';

export const AI_MODEL = 'claude-sonnet-4-6';

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** Strip markdown code fences models sometimes wrap JSON responses in. */
export function stripJsonFences(text: string): string {
  return text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
}

/**
 * Call Claude for a single structured JSON response. On any failure (bad key,
 * rate limit, malformed output) falls back to `fallback` so the route still
 * returns a usable payload instead of a 500 — and marks the response with an
 * `X-AI-Fallback` header so a caller (or monitoring) can tell canned data
 * from a real model response instead of the two being indistinguishable.
 */
export async function generateJson<T>(
  res: Response,
  params: {
    system: string;
    prompt: string;
    maxTokens?: number;
    fallback: T;
    onError?: (error: unknown) => void;
  }
): Promise<T> {
  try {
    const message = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: params.maxTokens ?? 1500,
      system: params.system,
      messages: [{ role: 'user', content: params.prompt }],
    });
    const rawContent = message.content[0].type === 'text' ? message.content[0].text : '';
    return JSON.parse(stripJsonFences(rawContent)) as T;
  } catch (error) {
    params.onError?.(error);
    res.setHeader('X-AI-Fallback', 'true');
    return params.fallback;
  }
}

/**
 * Stream a Claude chat completion to the client over SSE. On failure, writes
 * a single fallback message chunk (flagged with `aiFallback: true` so the
 * frontend/observability can distinguish it from a real streamed reply)
 * instead of dropping the connection.
 */
export async function streamChatResponse(
  res: Response,
  params: {
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    maxTokens?: number;
    fallbackText: string;
    onError?: (error: unknown) => void;
  }
): Promise<void> {
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
  } catch (error) {
    params.onError?.(error);
    res.write(`data: ${JSON.stringify({ text: params.fallbackText, aiFallback: true })}\n\n`);
  }

  res.write('data: [DONE]\n\n');
  res.end();
}
