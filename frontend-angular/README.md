# VesselMind Ops Dashboard — Angular Frontend

An Angular 22 fleet-operations dashboard for the existing **VesselMind** backend
(Express + Prisma + PostgreSQL). It lives alongside the primary React frontend as
a separate, self-contained app — a focused ops surface for browsing the fleet,
searching vessels, registering/editing them, and reading a live fleet summary.

Built with modern Angular only: **standalone components, signals, functional
guards/interceptors, and RxJS** for the async search — no NgModules, no NgRx.

---

## Running it

You need two processes: the backend API and this Angular dev server.

### 1. Backend (from the repo root `backend/`)
```bash
cd ../backend
npm install
npm run dev          # serves the API on http://localhost:3001
```
The backend degrades gracefully: with no Postgres running it serves in-memory
fixtures and honours the demo login, so you can run the whole dashboard without a
database.

### 2. This app (`frontend-angular/`)
```bash
npm install
npm start            # ng serve on http://localhost:4200
```
> **Node version:** Angular 22's CLI requires Node ≥ 24.15 (or ≥ 22.22). Use
> `fnm use 24` / `nvm use 24` if your default Node is older.

Open <http://localhost:4200> and sign in with the demo account:

```
demo@petronas.com  /  demo123
```

The dev server proxies `/api/*` to `http://localhost:3001` (see `proxy.conf.json`),
so requests are same-origin in development and there are no CORS preflights.

### Useful scripts
| Command | What it does |
| --- | --- |
| `npm start` | Dev server with proxy + HMR |
| `npm run build` | Production build (esbuild) to `dist/` |
| `npm test` | Unit tests (Vitest, the Angular 22 default runner) |

---

## Architecture decisions

**Standalone components, no NgModules.** Every component declares its own
`imports`. Routing is a flat `Routes` array with `loadComponent` lazy-loading, so
each feature ships as its own JS chunk (`login`, `shell`, `dashboard`,
`vessels-page`, `vessel-form`) and the initial bundle stays tiny.

**Signals for state, RxJS only where it earns its place.**
- Component and app state (auth, toasts, table sort/filter/pagination, dashboard
  metrics) is held in `signal()` / `computed()`. Derived values recompute
  automatically with no manual subscriptions and no `BehaviorSubject`
  bookkeeping.
- RxJS is used for the one thing it's genuinely best at: the debounced
  type-ahead search (`debounceTime` → `distinctUntilChanged` → `switchMap`),
  which needs cancellation of in-flight requests. The stream is bridged into a
  signal with `toSignal` so the rest of the component stays signal-based.

**Cross-cutting concerns live in interceptors, not in every call.** A functional
auth interceptor attaches the JWT to every request; a functional error
interceptor handles failures globally — 401 logs out and redirects, everything
else raises a toast. Services and components contain no token handling and no
try/catch boilerplate.

**Tenant-safe backend.** Search is server-side (`GET /api/vessels?search=`) and
create/update are scoped to the caller's own fleet on the server, so the client
can't inject a vessel into another tenant's fleet.

### Project layout
```
src/app/
  core/
    models/        vessel + user interfaces
    services/      auth, vessel (HttpClient wrappers), notification (toast bus)
    guards/        authGuard (functional CanActivateFn)
    interceptors/  auth (attach JWT) + error (global handling)
  features/
    login/         reactive login form
    shell/         authenticated layout (header/nav + <router-outlet>)
    dashboard/     signals + computed() fleet summary
    vessels/       data table + RxJS search, and the reactive create/edit form
  shared/          toast host
```

The code is written to teach: non-obvious Angular idioms (signals, `inject()`,
guards, RxJS operators) carry inline comments, and a few key files include a
short block contrasting the modern approach with the pre-v17 NgModule +
`@Input()`/`@Output()` style you'd meet in a legacy codebase.

---

## What I built (interview summary)

> I built a fleet-operations dashboard in Angular 22 against an existing
> Node/Prisma/Postgres backend, using only the modern Angular toolkit —
> standalone components, signals, functional route guards and HTTP interceptors.
> Authentication is a functional guard over a JWT auth service whose state is a
> signal, with the token attached and errors handled by two interceptors so no
> service carries auth or try/catch boilerplate. The vessel table does its
> sorting, filtering and pagination as a chain of `computed()` signals over the
> server response, while the search box is a proper RxJS type-ahead
> (`debounceTime` + `distinctUntilChanged` + `switchMap`) that hits a
> server-side `?search=` endpoint and cancels stale requests — verified in the
> network tab as one request per settled query, not one per keystroke. The
> create/edit screen is a strongly-typed reactive form with built-in validators
> plus two custom ones: a field-level build-year range and a cross-field rule
> that a vessel's design speed can't exceed its max speed. The dashboard summary
> is built entirely from signals and `computed()` — one HTTP source, several
> derived metrics — deliberately avoiding a hand-managed `BehaviorSubject`
> service. I kept state management to signals and services rather than reaching
> for NgRx, because that's the reasoning I want to be able to defend.
