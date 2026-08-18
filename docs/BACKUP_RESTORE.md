# Backup and restore

Scheduled logical backups of Postgres, and the restore procedure — **performed
against this cluster, not written from memory.** A backup nobody has restored is
an untested script with optimistic naming.

## What runs

`k8s/base/12-postgres-backup.yaml`: a CronJob at 02:00 daily writing gzipped
`pg_dump` output to a PersistentVolumeClaim.

Three objects deep — **CronJob creates Job creates Pod** — which is why
debugging one means looking at all three:

```bash
kubectl get cronjob,job,pod -n vesselmind
```

### The fields that carry weight

| Field | Value | Why |
|---|---|---|
| `concurrencyPolicy` | `Forbid` | If the previous run is still going, skip rather than overlap. `Allow` (the default) lets two `pg_dump`s compete for the same database and volume; `Replace` kills one midway and leaves a truncated file that looks real |
| `startingDeadlineSeconds` | `300` | If the controller was down and a run was missed, only start it if less than 5 minutes late. Otherwise a cluster that was off overnight starts a backup at a random morning moment |
| `successfulJobsHistoryLimit` | `3` | Completed Jobs and Pods otherwise accumulate forever — hundreds of etcd objects within a year |
| `failedJobsHistoryLimit` | `3` | Keeping failures is the point. A failed backup whose logs were garbage-collected tells you nothing |
| `backoffLimit` | `2` | Then stop and stay visibly failed. A backup that retries forever looks healthy until you need the file |
| `restartPolicy` | `Never` | Fresh pod per attempt, so a failed attempt's logs survive |

`schedule` is interpreted in the **kubelet's timezone** (UTC here) unless
`spec.timeZone` is set. Assuming local time is a good way to schedule a heavy job
straight into peak traffic.

### Two things the dump script does that are easy to skip

**It verifies the archive before declaring success.**

```sh
gzip -t "$OUT"
```

A truncated write — exactly what a full disk produces — yields a file of
plausible size that fails only on restore day. Testing the archive turns a silent
corruption into a loud job failure.

**It enforces retention.**

```sh
find /backups -name 'vesselmind-*.sql.gz' -mtime +7 -delete
```

Unbounded backups fill the volume, and then every *future* backup fails. That is
a slow-motion outage which starts the day you stop paying attention.

The dump uses `--clean --if-exists`, so it drops objects before recreating them
and a restore needs no manually emptied database first. `PGPASSWORD` comes from
the environment rather than the command line, where it would be visible in `ps`.

## The restore, actually performed

**1. Take a backup and confirm the starting state**

```
backup ok: /backups/vesselmind-20260818T111241Z.sql.gz (6637 bytes)
retained: 1 file(s)

3 vessels: MT Kerteh Venture, MV Merdeka Spirit, OSV Tenaga Satu
```

**2. Destroy the data**

```bash
kubectl exec -n vesselmind postgres-0 -- \
  psql -U vesselmind -d vesselmind -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
```

Tables: `0`. The app immediately reported:

```json
{"error":"Database unavailable. Use demo@petronas.com / demo123"}
```

**3. Restore**

A one-off Job mounting the same PVC, taking the newest archive:

```sh
LATEST=$(ls -1t /backups/vesselmind-*.sql.gz | head -1)
gzip -t "$LATEST"
gunzip -c "$LATEST" | psql -v ON_ERROR_STOP=1 -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE"
```

`ON_ERROR_STOP=1` matters: without it `psql` continues past failed statements and
exits 0, producing a "successful" restore of a partially populated database.

**4. Verify**

```
3 vessels: MT Kerteh Venture, MV Merdeka Spirit, OSV Tenaga Satu
tables: 24
migration history intact: 3 applied
fleet after restore: 3 vessels
```

The API recovered **with no pod restart and no re-seed** — Prisma reconnects
lazily, so the pods never noticed. `_prisma_migrations` came back with the dump,
so the schema is not merely present but correctly versioned; a future
`migrate deploy` will know what has already been applied.

## What this does not cover

- **Logical, not physical.** `pg_dump` gives a consistent snapshot at one moment.
  Point-in-time recovery needs WAL archiving (`pgBackRest`, `wal-g`) — with this
  setup, anything written since 02:00 is gone.
- **The backup volume is `local-path` on one node.** The backups live on the same
  physical machine as the database. A node failure takes both. Real backups go
  off-host: S3, and ideally a different account or region.
- **Nothing verifies restores on a schedule.** This restore was performed once, by
  hand. The mature version restores into a scratch database automatically and
  alerts when that fails — otherwise "we have backups" degrades quietly into "we
  have files".
- **Not encrypted at rest.** The dump contains user records and bcrypt hashes.
- **RWO volume**, so the backup pod and any restore pod must land on the same node
  as the volume. Kubernetes schedules them there automatically via volume node
  affinity, but it constrains placement — another reason real backups go to
  object storage rather than a block volume.

## Restoring in an emergency

```bash
kubectl get pods -n vesselmind -l job-name=postgres-backup --sort-by=.metadata.creationTimestamp
kubectl apply -f k8s/jobs/postgres-restore.yaml
kubectl wait --for=condition=complete job/postgres-restore -n vesselmind --timeout=300s
kubectl logs job/postgres-restore -n vesselmind
```

Delete the Job afterwards — a completed Job blocks re-applying the same name.
