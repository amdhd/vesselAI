# Database migrations on Kubernetes

How VesselMind applies its Prisma migrations in-cluster, what was tried first,
and what a real team does differently. Phase 3 of the Kubernetes migration.

## The problem

The migration and seed steps need tooling the API's runtime image does not fully
carry. `backend/Dockerfile.prod` runs `npm prune --omit=dev` in a `prune` stage,
which removes `ts-node` — so `prisma/seed.ts` cannot run there.

**Correction (Phase 4).** This document originally claimed the Prisma CLI was
also pruned away. It is not. `@prisma/client` declares `prisma` as an optional
peer dependency, so npm keeps it in the production tree, and the runtime image
ships a working `node_modules/.bin/prisma` (verified: 5.22.0). Migrations alone
could have run from the runtime image. Seeding could not, which is why the Job
still targets the `build` stage — the right conclusion, reached originally for
the wrong reason.

Solution: build the `build` stage of the same Dockerfile as a second image. It
still carries the Prisma CLI, `ts-node`, and `prisma/migrations/`.

```bash
docker build --target build -t vesselmind/migrate:0.1.0 -f backend/Dockerfile.prod backend
```

Tradeoff: that image is much larger than the runtime one and contains build
tooling you would rather not ship. A production setup builds a purpose-made
migration image — schema, migrations, and a migration binary, nothing else.

## Attempt 1 — initContainer on the API Deployment (the naive way)

An `initContainer` runs to completion before the pod's main container starts. So
the obvious move is to attach one to the API Deployment:

```yaml
initContainers:
  - name: migrate
    image: vesselmind/migrate:0.1.0
    command: ['node_modules/.bin/prisma', 'migrate', 'deploy']
```

At `replicas: 3` this means three pods migrate the same database at once.

### What actually happened

First run was inconclusive, and the reason is worth recording: a **rolling update
staggers pod creation**, so the new ReplicaSet scaled up one pod at a time and
only one ever ran a migration. The race was hidden by the rollout strategy, not
absent.

Forcing the real case — wipe the schema, scale to 0, then scale to 3 so all pods
start simultaneously:

```
pod 1:  3 migrations found → Applying 20260404095836_init
                           → Applying 20260712120000_add_weather_observation
                           → Applying 20260712130000_add_ais_vessel_position
                           → All migrations have been successfully applied.
pod 2:  3 migrations found → No pending migrations to apply.
pod 3:  3 migrations found → No pending migrations to apply.
```

Result: 24 tables, all three migrations recorded exactly once in
`_prisma_migrations`. **It worked.** Prisma takes a PostgreSQL advisory lock
before applying, so pods 2 and 3 blocked until pod 1 finished, then found
nothing left to do.

### Why it is still the wrong pattern

"It worked" is not a defence, and this is the part worth being able to argue:

1. **The safety comes from the library, not the deployment.** Prisma's advisory
   lock is an implementation detail. A different migration tool — or a different
   version — removes the guarantee, and nothing about the Kubernetes objects
   would change to warn you.
2. **Lock waits time out.** Three fast migrations against a local database is the
   easy case. A slow migration and more replicas turns waiting pods into failed
   pods.
3. **Every pod runs it, forever.** Not just on deploy: every restart, every
   scale-up, every replacement pod re-checks migrations against the production
   database. That is permanent load and permanent risk for a one-time operation.
4. **A failed migration becomes a total outage.** If the initContainer fails, no
   pod becomes Ready, so nothing serves traffic. As a separate Job, a failed
   migration leaves the currently-running app completely untouched — a failed
   deploy instead of an incident.
5. **You cannot inspect before rolling.** Risky migrations want to be run once,
   checked, and only then followed by the new application version. Coupling them
   to pod startup removes that option.

## Attempt 2 — a Job (the way it is now)

`k8s/base/07-db-init-job.yaml`. A Job runs pods to completion and stops, unlike a
Deployment which restarts them forever.

```
initContainer: migrate  → node_modules/.bin/prisma migrate deploy
container:     seed     → node_modules/.bin/ts-node prisma/seed.ts
```

Fields that carry weight:

- **`backoffLimit: 2`** — how many pod failures before Kubernetes gives up. Low
  deliberately: a failing migration is a bug to read, not something to retry into
  submission.
- **`ttlSecondsAfterFinished: 600`** — deletes the Job and its pods 10 minutes
  after completion. Without it, finished Jobs accumulate forever.
- **`restartPolicy: Never`** — each attempt gets a *fresh pod*, so a failed
  attempt's logs survive for inspection. `OnFailure` restarts the container in
  place and makes forensics harder.
- **`node_modules/.bin/...` rather than `npx`** — npx wants a writable npm cache
  under `$HOME` and may reach for the network. Neither belongs in a migration.
- **Idempotent by construction** — every write in `prisma/seed.ts` is an upsert,
  so the Job can be re-run safely. A Job you are afraid to re-run is a liability.

### The ordering guarantee — two different kinds

This is the question to be precise about, because the two get conflated.

**Inside the pod: a real Kubernetes guarantee.** initContainers run to
completion, in declared order, before any main container starts. `migrate`
provably finishes before `seed` begins. That is enforced by the kubelet.

**Between the Job and the Deployment: no guarantee at all.** `kubectl apply -f k8s/base/`
submits every object at once; nothing sequences them. The ordering is enforced
*outside* the cluster, by the deploy procedure:

```bash
kubectl apply -f k8s/base/07-db-init-job.yaml
kubectl wait --for=condition=complete job/db-init -n vesselmind --timeout=240s
kubectl apply -f k8s/base/
```

That dependency currently lives in a runbook, which is a weakness worth naming
rather than hiding. A real setup encodes it declaratively — **Argo CD sync-waves**
or **Helm hooks** — so the ordering is part of the manifests instead of part of
somebody's memory. That arrives in Phase 8.

## Consequence: NODE_ENV back to production

With a seeded database there is finally a real account, so the demo-login bypass
is no longer needed and `NODE_ENV` returns to `production`. Verified in-cluster:

```
wrong password   -> 401 Invalid email or password     (bcrypt is really being checked)
demo@petronas.com/demo123 -> 200 Captain Ahmad Fauzi  (normal password path, real row)
fleet            -> 3 vessels from Postgres           (not the 12 in-memory fixtures)
```

Before this phase, login worked through a hardcoded bypass and the vessels came
from `src/mock/vessels.ts` — reads looked correct but writes did not persist.
Now they do.

**This creates an ordering dependency on a fresh cluster:** applying these
manifests without running the Job first leaves an API in production mode against
an empty database, where every login fails.

## What a real team does beyond this

- **Expand / contract.** Never make a migration that the currently-running code
  cannot tolerate. Add a nullable column, deploy code that writes it, backfill,
  *then* make it non-null and drop the old one — several deploys, each safe
  alone. The alternative is a window where old pods and new schema disagree,
  which is exactly what a rolling update guarantees will happen.
- **Migration locks as a first-class concern**, not a library side effect.
- **Backward-compatible rollback.** A migration that cannot be rolled back means
  the application cannot be rolled back either.
- **Run migrations separately from deploys** for anything risky, so the blast
  radius of a bad migration is not "the entire application".
- **Statement timeouts and `CONCURRENTLY`** on large tables, so a migration
  cannot lock a hot table long enough to take the site down.

## Operational note

`kubectl apply` will not remove a field that was added imperatively with
`kubectl patch`. Its three-way merge only removes fields it previously managed,
and a patched-in `initContainers` block was never in the last-applied
configuration. Removing it needs an explicit JSON patch:

```bash
kubectl patch deployment api -n vesselmind --type=json \
  -p '[{"op":"remove","path":"/spec/template/spec/initContainers"}]'
```

Mixing imperative and declarative changes to the same object is how clusters
drift from their manifests. Phase 8's GitOps setup exists largely to make that
impossible.
