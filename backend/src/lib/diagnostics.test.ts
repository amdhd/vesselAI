import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { safeLogSerializers } from './diagnostics';

const secret = 'DUMMY_PRIVATE_CREDENTIAL';

describe('safe diagnostic serialization', () => {
  it('excludes secrets from exception messages, stacks, nested causes and request/response metadata', () => {
    const lines: string[] = [];
    const log = pino({ serializers: safeLogSerializers }, { write: (line) => { lines.push(line); } });
    const error = Object.assign(new Error(`postgres://user:${secret}@example.test/db`), {
      stack: secret, cause: new Error(secret), code: 'P2002', status: 503,
      response: { data: secret }, token: secret,
    });
    log.error({
      err: error,
      req: { id: 1, method: 'GET', url: `/private/${secret}?token=${secret}`, headers: { authorization: secret }, body: secret },
      res: { statusCode: 503, headers: { 'set-cookie': secret } },
    }, 'request failed');
    expect(lines.join('')).not.toContain(secret);
    expect(JSON.parse(lines[0]).err).toEqual({ type: 'Error', code: 'P2002', status: 503 });
    expect(JSON.parse(lines[0]).req).toEqual({ id: 1, method: 'GET' });
  });

  it('does not pass through arbitrary string errors or diagnostic codes', () => {
    expect(safeLogSerializers.err(secret)).toEqual({ type: 'UnknownError' });
    expect(safeLogSerializers.err({ code: secret, status: secret, name: secret })).toEqual({ type: 'UnknownError' });
  });
});
