// Error messages, stacks, causes and provider payloads can contain credentials
// or private content. Keep only bounded diagnostic categories in shared logs.
export function serializeSafeError(error: unknown) {
  const value = error && typeof error === 'object' ? error as { code?: unknown; status?: unknown } : {};
  const code = typeof value.code === 'string' && (
    /^P\d{4}$/.test(value.code)
    || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(value.code)
  ) ? value.code : undefined;
  const status = typeof value.status === 'number' && Number.isInteger(value.status)
    && value.status >= 100 && value.status <= 599 ? value.status : undefined;
  return {
    type: error instanceof TypeError ? 'TypeError' : error instanceof Error ? 'Error' : 'UnknownError',
    ...(code ? { code } : {}),
    ...(status ? { status } : {}),
  };
}

export const safeLogSerializers = {
  err: serializeSafeError,
  req: (req: { id?: number | string; method?: string }) => ({
    id: req.id,
    method: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'].includes(req.method ?? '') ? req.method : 'UNKNOWN',
  }),
  res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
};
