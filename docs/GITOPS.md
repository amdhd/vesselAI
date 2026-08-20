# GitOps with Argo CD

How VesselMind deploys. Phase 8 of the Kubernetes migration.

## What changed

Before: deployment was a human running `kubectl apply -k k8s/overlays/dev`.

After: Argo CD runs **inside** the cluster, reads this repository, and
continuously reconciles the cluster to match it. A commit to `main` is a deploy.
A manual change to a live object is reverted.

## Push vs pull, honestly

| | Push (CI runs `kubectl apply`) | Pull (Argo CD) |
|---|---|---|
| Credentials | CI holds cluster admin, so whoever compromises CI reaches production | Cluster reads git; no external system holds cluster credentials |
| Drift | Invisible. CI applied once and never looked again | Detected continuously, and optionally reverted |
| Deploy feedback | Synchronous — the pipeline goes green | Asynchronous — you watch it converge |
| Complexity | A pipeline step | A controller to run, upgrade and understand |

Push-based is genuinely fine for many teams and simpler to reason about. The
reason to prefer pull here is **drift detection**: the value is not that deploys
get easier, it is that the cluster's state becomes knowable.

## Install

Upstream plain-YAML manifests, pinned to a release, no Helm — consistent with
the rest of this project.

```bash
kubectl create namespace argocd
kubectl apply -n argocd --server-side \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/v3.5.1/manifests/install.yaml
```

**`--server-side` is required, not a preference.** Client-side apply stores the
whole object in a `last-applied-configuration` annotation, and the
`applicationsets.argoproj.io` CRD exceeds the 256KB annotation limit:

```
The CustomResourceDefinition "applicationsets.argoproj.io" is invalid:
metadata.annotations: Too long: may not be more than 262144 bytes
```

Server-side apply keeps field ownership on the server and has no such limit.

Cost: **~339Mi across 7 pods** (server, application-controller, repo-server,
redis, dex, notifications, applicationset-controller).

## Adopting a cluster that already exists

Everything here was originally created with `kubectl apply` by hand. On first
look Argo reported **all 37 objects OutOfSync** — not because the content
differed, but because none carried Argo's tracking metadata:

```
argocd.argoproj.io/tracking-id: vesselmind:/Service:vesselmind/api
```

Argo CD v3 tracks by *annotation*; older versions used the
`app.kubernetes.io/instance` label. Either way, **the first sync is an adoption,
not a no-op.** Worth knowing before migrating a live cluster into GitOps: expect
everything to look out of sync until Argo takes ownership once.

## The hazard, which is the same thing as the feature

Argo was deliberately created with automated sync **off**, because at that moment
`main` did not yet contain Phase 7. With auto-sync on, Argo would have made the
cluster match git — faithfully **deleting** the Pod Security Standards,
NetworkPolicies and PodDisruptionBudgets, because git said they did not exist.

That is the tool working correctly. It enforces whatever git says, including
*"that hardening is not real"*. GitOps makes git the production control plane,
which is only an improvement if git is actually the source of truth.

`prune: true` deserves the same care: removing a file from git deletes the object
from the cluster. That is the point, and it is also how a PersistentVolumeClaim
disappears because somebody tidied a directory.

## Self-healing, demonstrated — and then deliberately disabled

During Phase 8 we ran the drift demo with `selfHeal: true`: a manual change
to a live object gets reverted:

```
$ kubectl scale deployment/web -n vesselmind --replicas=5
  immediately after manual change: 5 replicas
  REVERTED to 2 replicas after ~5s
```

Argo's controller logged `Syncing` and `Partial sync operation to 1a71c3b`, and
the deployment returned to the two replicas the overlay specifies.

Self-heal is now OFF, not because the demo failed but because of a verified
interaction with the db-init PreSync hook (`k8s/base/07-db-init-job.yaml`):
the hook Job, while it exists, looks like drift to the self-heal loop, which
responds with a resource-scoped partial sync. Partial syncs skip hooks by
design, and a partial sync REPLACES an in-flight full sync's operation — twice
on the live cluster a full sync was recorded `Succeeded` ~2s in while the hook
Job was still running, and once the replacement hook Job was never created at
all. The full story is in the comment on `automated.selfHeal` in
`k8s/argocd/01-application.yaml`.

The trade this makes: auto-sync on git change still works (full syncs run the
hook), but drift correction is now a manual `argocd app sync` — GitOps reports
drift and a human decides, instead of the controller reverting it.

Recovery note: a partial sync's operation persists in `status.operationState`
and, through the controller's informer write-back, kept resurfacing in later
syncs even after selfHeal was off — each new full sync was replaced ~2s in by
a resurrected partial one. The fix was purging the field once
(`kubectl patch app vesselmind -n argocd --type=merge -p
'{"status":{"operationState":null}}'`), after which a full sync ran the hook
end to end: `waiting for completion of hook batch/Job/db-init`, then
`successfully synced (all tasks run)` with `hookPhase: Succeeded`.

## Access

```
http://localhost:8080/argocd
```

Served under a subpath, which needs both `server.rootpath` (or redirects and
asset URLs point at `/` and the UI half-loads) and `server.insecure` (Argo
terminates TLS itself by default, which behind a plain-HTTP Ingress produces a
redirect loop).

The initial admin password lives in the `argocd-initial-admin-secret` Secret,
readable by anyone with `get secret` in that namespace. **Local-only**: a real
deployment rotates it, deletes that Secret, and puts SSO in front.

## What is still missing

- **The image tag is not updated automatically.** CI publishes
  `ghcr.io/amdhd/vesselai-api:<sha>`, but the overlay pins a version by hand, so
  a deploy still means editing a manifest. Closing that loop means Argo CD Image
  Updater, or a CI step that commits the new tag — the latter being the more
  auditable of the two.
- **One Application, one cluster.** Multiple environments would use an
  app-of-apps pattern or ApplicationSets.
- **No sync windows and no notifications.** Production wants both: a maintenance
  window during which syncs may run, and an alert when one fails.
- **Argo has cluster-admin.** Scoping it to the namespaces it manages is real
  work and a real hardening step.
