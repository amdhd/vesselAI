# Phase 1 checklist — API + Postgres on k3d

The list of objects, the fields that actually carry weight, and what each one is
protecting you against. The manifests themselves live in `k8s/base/`, one file
per object; this is the checklist to review them against. Field paths are given
so you can look each one up yourself (`kubectl explain statefulset.spec.serviceName`).

---

## 0. Namespace

- `metadata.name: vesselmind`. Everything below lives in it.
- Set the context default once (`kubectl config set-context --current --namespace=vesselmind`)
  so you stop typing `-n`. Muscle memory for `-n` is worth more in an interview, your call.

---

## 1. Secret — `vesselmind-secrets`

Keys the app actually reads (verified against `backend/src/config/env.ts` and
`backend/src/lib/jwtConfig.ts`):

| Key | Consumed by | Rules that will bite you |
|---|---|---|
| `POSTGRES_PASSWORD` | Postgres container + the API's `DATABASE_URL` | must match on both sides or the API gets `P1000 auth failed` |
| `DATABASE_URL` | API | `z.string().url()` — must parse as a URL, and is **required when `NODE_ENV=production`** |
| `JWT_SECRET` | API | **≥ 32 chars**, or the process throws at boot when `NODE_ENV=production` |
| `ANTHROPIC_API_KEY` | API | genuinely optional — `aiService` falls back to canned responses |

Fields that matter:

- `stringData` vs `data` — `stringData` is write-only convenience, it is *not*
  encryption. `kubectl get secret -o yaml` still hands back base64 that anyone
  with read access decodes in one command.
- Decide now whether the API gets these via `envFrom.secretRef` (all keys, names
  must match exactly) or per-key `env[].valueFrom.secretKeyRef` (explicit, and
  the one that makes Phase 2 break #5 legible). Recommend per-key here.

**Local-only shortcut to write in a comment in the file:** a plaintext Secret in
git is fine for k3d and wrong everywhere else. Production wants External Secrets
Operator / SOPS / IRSA-backed Secrets Manager. Say the words in the file so you
can volunteer the limit unprompted.

---

## 2. ConfigMap — `vesselmind-config`

Non-secret env the API reads: `PORT` (`3001`), `NODE_ENV`, `FRONTEND_URL`,
`LOG_LEVEL`, `POSTGRES_USER`, `POSTGRES_DB`.

Decide deliberately: **`NODE_ENV=production` or not?** It is not cosmetic here.

- `production` → `DATABASE_URL` becomes mandatory, `JWT_SECRET` < 32 chars is
  fatal, demo login is disabled (`DEMO_LOGIN_ENABLED`), and a bad env makes the
  pod exit at boot (`process.exit(1)`) → `CrashLoopBackOff`.
- non-production → the app boots on almost anything and degrades quietly.

This choice changes the *symptom* of Phase 2 break #5 (secret key mismatch).
Under `production` you get a crash loop at boot; otherwise you get a pod that
goes Ready and then errors per-request. Pick one and know which you picked.

---

## 3. Postgres — headless Service + StatefulSet + volumeClaimTemplate

### 3a. Headless Service `postgres`

- `spec.clusterIP: None` — this is what makes it headless. DNS returns pod IPs
  directly instead of a single virtual IP, which is what gives you the stable
  per-pod name `postgres-0.postgres.vesselmind.svc.cluster.local`.
- `spec.selector` must match the StatefulSet's pod labels. A typo here yields a
  Service with zero Endpoints and an API that hangs on connect — check with
  `kubectl get endpoints postgres`.
- `spec.ports[].port: 5432`, `targetPort: 5432`.

### 3b. StatefulSet `postgres`

- `spec.serviceName` **must** equal the headless Service name. This is the field
  people miss; without it the per-pod DNS records don't get created.
- `spec.replicas: 1`. One Postgres. A StatefulSet does not give you replication
  — it gives you stable identity and stable storage. Be precise about that
  distinction if asked.
- `spec.volumeClaimTemplates` (not `spec.template.spec.volumes`): each replica
  gets its own PVC, named `<claim>-<statefulset>-<ordinal>`. Set
  `resources.requests.storage` (1–2Gi is plenty) and leave `storageClassName`
  unset so k3d's default `local-path` is used.
- Container `image: postgres:16-alpine` (match compose so you aren't debugging
  two variables).
- Env: `POSTGRES_USER`, `POSTGRES_DB` from the ConfigMap; `POSTGRES_PASSWORD`
  from the Secret.
- `PGDATA`: mounting a volume at `/var/lib/postgresql/data` and pointing initdb
  at that same path breaks on any volume that isn't perfectly empty. The
  conventional fix is `PGDATA=/var/lib/postgresql/data/pgdata` — a subdirectory
  of the mount. k3d's `local-path` gives you a clean dir so it works either way;
  set it anyway and comment why.
- `volumeMounts[].mountPath: /var/lib/postgresql/data`, `name` matching the
  claim template.
- Probes: use `pg_isready -U $POSTGRES_USER` as an **exec** probe. There is no
  HTTP endpoint to hit. Readiness matters more than liveness here — a liveness
  probe that restarts a slow-recovering Postgres makes an outage worse.
- `resources.requests` ~256Mi / 100m, `limits` ~512Mi. See the memory note at
  the bottom.

---

## 4. API — Deployment + ClusterIP Service

### 4a. Deployment `api`

- `image`: `backend/Dockerfile.prod` (multi-stage, non-root, `dumb-init` PID 1,
  `CMD node dist/server.js`). Not `backend/Dockerfile` — that one is the dev
  image and runs `ts-node-dev` with a bind mount.
- `imagePullPolicy`: with a locally-imported image (`k3d image import`), `Always`
  will fail. `IfNotPresent` and a real tag. **Never `:latest`** — it makes
  rollouts non-deterministic and it's exactly what Phase 2 break #1 exploits.
- `containerPort: 3001` (from `PORT`, defaulted in `config/env.ts`).
- Env: `envFrom` the ConfigMap plus per-key `secretKeyRef` entries.
- `replicas: 1` for now. Phase 3 takes it to 3.
- **Probes — read this before you write them:**
  - The only endpoint that exists is `GET /api/health` (`backend/src/app.ts`).
    It returns `{status:'ok'}` unconditionally. **It does not touch the
    database.** There is no `/ready`, no `/live`.
  - Consequence: a readiness probe on `/api/health` reports Ready even when
    Postgres is unreachable, because Prisma connects lazily on first query. The
    pod will take traffic and 500 it. That is a real gap — flag it in a comment
    now, because it is the honest answer to "how would you make this
    production-grade?" and it changes what you expect to see in Phase 2 break #6.
  - `readinessProbe` = "can this pod take traffic?" Failure pulls the pod out of
    the Service Endpoints. Non-fatal.
  - `livenessProbe` = "is this process wedged?" Failure **restarts the
    container**. Set `initialDelaySeconds` / `failureThreshold` with room to
    spare; an aggressive liveness probe turns slow starts into a crash loop.
  - There is no `startupProbe` need here (boot is fast), but know it exists and
    what it's for.
- `resources`: `requests` is what the scheduler uses to place the pod; `limits`
  is what the kernel enforces at runtime. Memory over limit = **OOMKilled**
  (hard kill, exit 137). CPU over limit = **throttled**, never killed. Those two
  being different mechanisms is the entire point of Phase 2 breaks #2 and #7.
  Start around requests 128Mi/100m, limits 512Mi/500m.
- `securityContext`: the image already runs as `node`. `runAsNonRoot: true`,
  `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem` — try it and see
  what breaks.

### 4b. Service `api`

- `type: ClusterIP` (the default). NodePort/LoadBalancer are Phase 4's problem;
  reach it with `kubectl port-forward` until then.
- `port: 3001`, `targetPort: 3001`, `selector` matching the pod labels.
- Verify with `kubectl get endpoints api` — an empty Endpoints list means your
  selector doesn't match your pod labels, and it's the single most common
  self-inflicted Phase 1 wound.

---

## Known gaps in the app that Phase 1 will surface

These are app-side facts, not YAML mistakes. Don't "fix" them by changing config
until it works.

1. **No migrations run anywhere in Phase 1.** The schema is applied by
   `prisma migrate deploy`, and the Prisma CLI is a devDependency that
   `Dockerfile.prod`'s prune stage strips out of the runtime image. So the API
   will come up against an empty database and every DB-backed route will fail.
   Options: accept it for Phase 1 and reach `/api/health` only, or apply
   migrations once by hand from a throwaway pod built on the `build` stage. Take
   the shortcut knowingly and write it in a comment — Phase 3 is where it gets
   solved properly.
2. **No SIGTERM handler** in `backend/src/server.ts`. `dumb-init` forwards the
   signal correctly, but Node's default action is immediate exit, so in-flight
   requests are dropped on every rollout and every scale-down. Relevant the
   moment you touch `terminationGracePeriodSeconds`.
3. **Socket.io + `express-rate-limit` are both per-pod state.** Fine at
   `replicas: 1`. At 3 replicas (Phase 3) the rate limiter's effective ceiling
   triples and the websocket handshake breaks without sticky sessions or a Redis
   adapter. Worth knowing before you scale, not after.
4. **`/metrics` exists** (prom-client, `backend/src/app.ts`), optionally
   bearer-protected via `METRICS_TOKEN`. Not needed until you want HPA on custom
   metrics — CPU-based HPA in Phase 5 uses metrics-server instead.

## Environment notes

- **Installed and running.** k3d cluster `vesselmind` is up (k3s v1.35.5, one
  server + one agent). `kubectl` v1.36.1 ships kustomize v5.8.1 built in, so
  `kubectl apply -k` covers Phase 6 with no extra install. `k6` still needs
  installing before Phase 5's load test.
- k3s already includes `metrics-server` (so Phase 5's CPU-based autoscaling
  needs no setup) and Traefik (so Phase 5's Ingress has a controller already).
- **Docker Desktop is allocated 3.83 GiB / 5 CPUs.** The k3s server alone takes
  roughly 700 MB before any workload. Phase 1 (Postgres + one API pod) fits
  comfortably; Phase 5 (3 API replicas, two nginx pods, Prometheus and a load
  test) will not fit. Raising Docker's memory to 6 GB in Docker Desktop settings now saves a
  confusing OOM later — and keep it distinct in your head from a *container*
  memory limit, which is what Phase 2 break #2 is about.

---

## Sealed Secrets (added during Phase 1)

Credentials are committed **encrypted**, not in plaintext. `k8s/base/02-sealedsecret.yaml`
is safe to publish; only the controller in this cluster can decrypt it.

Reproducing on a fresh cluster:

```bash
brew install kubeseal
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/download/v0.38.4/controller.yaml
kubectl rollout status deployment/sealed-secrets-controller -n kube-system
kubectl apply -f k8s/base/
```

**A fresh cluster generates a fresh key, which cannot decrypt the committed
file.** After any `k3d cluster delete`, either restore a backed-up key or
re-seal from the source values:

```bash
kubeseal --format yaml --controller-name sealed-secrets-controller \
  --controller-namespace kube-system < plain-secret.yaml > k8s/base/02-sealedsecret.yaml
```

The plaintext input must never be committed. Back the key up with
`kubectl get secret -n kube-system -l sealedsecrets.bitnami.com/sealed-secrets-key -o yaml`
— that output is a private key, so it does not belong in git either.

What this does and does not buy: it protects the *repository*. Once decrypted,
an ordinary Secret exists and anyone with `kubectl get secret` in the namespace
reads it. Limiting that is RBAC's job, in Phase 7.
