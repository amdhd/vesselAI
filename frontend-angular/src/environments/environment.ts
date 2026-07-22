/**
 * App-wide runtime configuration. In dev, `apiUrl` is a *relative* path ('/api')
 * that the Angular dev-server proxy (see proxy.conf.json) forwards to the
 * VesselMind backend on http://localhost:3001 — this keeps requests same-origin
 * so there are no CORS preflights during development. In production the Angular
 * bundle is served behind the same reverse proxy as the API, so '/api' resolves
 * correctly there too. Nothing here is secret; it ships to the browser.
 */
export const environment = {
  production: false,
  apiUrl: '/api',
};
