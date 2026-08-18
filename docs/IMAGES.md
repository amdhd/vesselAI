# Images and the registry

How VesselMind's container images get built, scanned, published and pulled.
Phase 4 of the Kubernetes migration.

## What this phase replaced

Phases 1–3 got images into the cluster like this:

```bash
docker build -t vesselmind/api:0.1.0 -f backend/Dockerfile.prod backend
k3d image import vesselmind/api:0.1.0 -c vesselmind
```

`k3d image import` copies a tarball straight into each node's containerd store.
It works, and it has **no equivalent outside a laptop**. A real cluster's nodes
pull from a registry; nothing hands them images. Any project that relies on
`image import` has skipped the entire question of how images get distributed.

## The local registry

```bash
k3d registry create vesselmind-registry --port 5111
k3d cluster create vesselmind --agents 2 --registry-use k3d-vesselmind-registry:5111
```

The registry must be attached at **cluster creation**; there is no way to add one
to a running k3d cluster, which is why this phase required a rebuild.

**One registry, two names, and confusing them is the usual first error:**

| From | Address |
|---|---|
| Your shell (pushing) | `localhost:5111` |
| Inside the cluster (pulling) | `k3d-vesselmind-registry:5111` |

The manifests use the second. Pushing uses the first.

```bash
docker tag vesselmind/api:0.1.0 localhost:5111/vesselmind/api:0.1.0
docker push localhost:5111/vesselmind/api:0.1.0
```

Verify what the registry holds:

```bash
curl -s http://localhost:5111/v2/_catalog
```

## Tags are immutable, and never `:latest`

Images are tagged with the **commit SHA**. This is the single most consequential
decision in this phase.

With `:latest`:
- Two pods on the same tag can be running different code, and nothing in the
  manifest tells you which.
- "Roll back" has no meaning — the previous image still exists but nothing names it.
- `imagePullPolicy` has to be `Always`, so every pod start depends on the registry
  being reachable.

With an immutable SHA tag:
- A pod's image *is* a pointer to the exact commit that built it.
- Rollback is "deploy the previous SHA".
- `IfNotPresent` is safe, because the tag can never mean something different
  later.

The pipeline also publishes a `main` tag as a human convenience for "what is
current". **Nothing should ever deploy from it.**

## CI: build, scan, publish

`.github/workflows/ci.yml`, job `publish-api-image`:

1. **Build** `backend/Dockerfile.prod`, loaded into the runner's local daemon.
2. **Scan** with Trivy, failing on `HIGH,CRITICAL`.
3. **Publish** to `ghcr.io/amdhd/vesselai-api:<sha>` — *only* on merge to main.

**Pull requests build and scan but never push.** An unreviewed branch must not be
able to publish an artifact. This also means the publish step is only exercised
after a merge, which is a real limitation of testing pipelines in a PR.

`ignore-unfixed: true` on the scanner is deliberate. A CRITICAL with no available
patch is not something the pipeline can act on, and failing on it trains everyone
to ignore the scanner — the worst possible outcome for a security gate. Unfixable
findings still appear in the job log.

Permissions are least-privilege: the workflow defaults to `contents: read`, and
only the publish job is granted `packages: write`.

## Deploying from GHCR instead of the local registry

Switching the cluster to the published image is two changes:

```yaml
image: ghcr.io/amdhd/vesselai-api:<commit-sha>
imagePullSecrets:
  - name: ghcr-pull
```

The pull secret, for a private package:

```bash
kubectl create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io \
  --docker-username=<github-user> \
  --docker-password=<token-with-read:packages> \
  -n vesselmind
```

That secret must not be committed in plaintext — it goes through `kubeseal` like
the others.

**Not yet wired up**, and the reason is honest: the image does not exist in GHCR
until this branch merges and CI runs on main. Doing it before then would mean
publishing an image from an unreviewed branch, which is precisely what the
pipeline is designed to prevent.

In Phase 9 this changes shape again: on EKS the registry is ECR, and the pull
credential disappears entirely — the node's IAM role grants registry access, so
there is no secret to manage. That is a genuine argument for cloud-native
registries worth being able to make.

## What a rebuild costs, and the trap that came with it

Recreating the cluster destroys the **sealed-secrets private key**, which makes
every committed `SealedSecret` permanently undecryptable. The Phase 1 doc warned
about it; this phase was the first real test of the recovery procedure.

```bash
# BEFORE deleting the cluster
kubectl get secret -n kube-system \
  -l sealedsecrets.bitnami.com/sealed-secrets-key -o yaml > sealed-key.backup.yaml

# AFTER recreating, once the controller is running
kubectl apply -f sealed-key.backup.yaml
kubectl delete pod -n kube-system -l name=sealed-secrets-controller
```

It worked — the committed `SealedSecret` decrypted on the rebuilt cluster with no
re-sealing. The backup file is a **plaintext private key** and lives outside the
repository. Losing it on a real cluster is an incident; here it would only mean
re-sealing from source values.

## A defect this phase surfaced

Deploying to the fresh cluster, `db-init` failed twice with
`P1001: Can't reach database server` before succeeding on the third attempt.

Cause: `kubectl apply -f k8s/base/` submits every object simultaneously, so the
migration Job started while Postgres was still booting. It only recovered because
`backoffLimit: 2` allowed exactly enough retries — luck, not design. A slower
database start and the Job would have failed permanently, leaving an unmigrated
schema behind a running API.

Fixed with a `wait-for-db` initContainer that blocks until the database accepts
TCP connections. Retrying until something works is not a fix; waiting for the
dependency is. This is the same missing-ordering problem described in
`MIGRATIONS.md`, and it keeps surfacing because Kubernetes genuinely has no
dependency graph between objects. Argo CD sync-waves in Phase 8 are what finally
express it declaratively.
