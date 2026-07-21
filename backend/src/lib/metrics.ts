import { Request, Response, NextFunction } from 'express';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

// Prometheus metrics registry. Exposes Node/process defaults plus a couple of
// app-specific series that matter for this service: HTTP latency and AI-call
// volume/outcome (cost + reliability signal).
export const registry = new Registry();
registry.setDefaultLabels({ service: 'vesselmind-api' });
collectDefaultMetrics({ register: registry });

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

export const aiRequestsTotal = new Counter({
  name: 'ai_requests_total',
  help: 'Anthropic API calls by label and outcome',
  labelNames: ['label', 'outcome'] as const, // outcome: success | rate_limited | error
  registers: [registry],
});

// Prefer the matched Express route pattern (e.g. /api/voyage/history/:vesselId)
// over the raw URL so metric cardinality stays bounded — a per-id path would
// otherwise explode the label set.
function routeLabel(req: Request): string {
  const base = (req.baseUrl || '') + ((req.route && req.route.path) || '');
  return base || req.path || 'unknown';
}

/** Times every request and records it into the latency histogram on finish. */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    end({ method: req.method, route: routeLabel(req), status: String(res.statusCode) });
  });
  next();
}
