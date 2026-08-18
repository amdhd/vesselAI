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

`.github/workflows/ci.yml`, job `publish-images` — a **matrix over every runtime
image**, so each one passes the same gate:

| Image | Built from |
|---|---|
| `vesselai-api` | `backend/Dockerfile.prod` |
| `vesselai-web` | `frontend/Dockerfile.prod` |

1. **Build**, loaded into the runner's local daemon.
2. **Scan** with Trivy, failing on `HIGH,CRITICAL`.
3. **Publish** to `ghcr.io/amdhd/<image>:<sha>` — *only* on merge to main.

The frontend was originally scanned only on a laptop. That is not a gate: a base
image can rot between manual checks and nothing catches it. `fail-fast: false`
so one image's findings never hide the other's.

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

## Scanning: what the first run found

Trivy on `vesselmind/api:0.1.0`, filtered to fixable HIGH and CRITICAL, returned
twelve vulnerable packages from **two quite different sources** — and the
distinction determined the fix.

### Source 1: npm's own bundle, inside the base image

`tar` (the only CRITICAL), `sigstore`, `glob`, `minimatch`, `cross-spawn`,
`brace-expansion` — all under `usr/local/lib/node_modules/npm/`. These are npm's
dependencies, shipped with `node:20-alpine`. Nothing in `package.json` controls
them.

The fix was not to patch them. **The runtime container runs
`node dist/server.js` and never invokes npm**, so npm was deleted from the final
stage:

```dockerfile
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
```

Removing an unused tool beats patching it: the vulnerabilities leave with it,
and a compromised container has one less way to execute arbitrary code. Worth
generalising — *why is this in my image at all* is usually a better question
than *how do I patch this*.

### Source 2: actual application dependencies

`multer`, `ws`, `engine.io`, `socket.io-parser`, `form-data`, `ip-address` under
`app/node_modules/`. These are real, and were fixed by upgrading.

`multer 1.4.5-lts.2 → 2.2.0` is a **major version bump on a direct dependency**
that handles file uploads. Typecheck and the full 94-test suite were run before
and after; both clean. A major bump on an upload handler is exactly where a
scanner's advice should not be taken on faith.

### Result

```
trivy --severity HIGH,CRITICAL --ignore-unfixed  →  exit 0
```

Republished as `0.2.0`. **Not** as `0.1.0` — a rebuilt image with different
content and the same tag is precisely the failure mode the immutable-tag policy
above exists to prevent. Changing content means changing the tag, including when
it is only a security patch.

## A correction this phase produced

Phase 3 stated that the Prisma CLI was pruned out of the runtime image, and used
that to justify a separate migration image. Inspecting the image directly showed
otherwise: `@prisma/client` declares `prisma` as an optional peer dependency, so
npm keeps it in the production tree and `node_modules/.bin/prisma` works fine in
the runtime image.

The separate image is still needed — `ts-node` really is pruned, and the seed
script needs it — so the conclusion held while the reasoning did not. Both
`MIGRATIONS.md` and the Dockerfile comment have been corrected. Assertions about
an image are cheap to verify and easy to get wrong from reading the Dockerfile
alone.

## Reaching the Ingress without port-forward

The cluster is created with a host port mapping so the Ingress is reachable
directly:

```bash
k3d cluster create vesselmind --agents 2 \
  --registry-use k3d-vesselmind-registry:5111 \
  -p "8080:80@loadbalancer"
```

`8080:80@loadbalancer` publishes host port 8080 to port 80 on the k3d
serverlb container, which forwards to Traefik. The app is then at
http://localhost:8080 with no `kubectl port-forward` running.

Like `--registry-use`, this can only be set **at cluster creation** — which is
why adding it meant a rebuild. Worth deciding both up front on a fresh cluster
rather than discovering them one rebuild at a time.

### What survives a rebuild, and what does not

| | Survives | Why |
|---|---|---|
| Registry contents | Yes | The registry is a separate container, independent of the cluster |
| Postgres data | **No** | `local-path` volumes live on the node containers |
| Sealed-secrets key | Only if backed up | Regenerated on a fresh install; the backup is the whole recovery path |

Postgres data being disposable is fine here only because `db-init` rebuilds it
from migrations and seed in seconds. That is a property of a demo, not of a
real system.

### A backup that silently produced nothing

During a Docker Desktop restart, this ran while the cluster was down:

```bash
kubectl get secret -n kube-system -l sealedsecrets... -o yaml > sealed-key.backup.yaml
```

`kubectl` could not reach the API server, so it wrote `items: []` — a valid YAML
file containing nothing — **over the previous good backup**, and exited 0. The
key survived only because the containers were merely stopped rather than deleted.

The fix is to verify the backup rather than trust the exit code:

```bash
kubectl get secret ... -o yaml > key.backup.yaml
grep -c 'tls.key' key.backup.yaml   # must be >= 1 before deleting anything
```

A backup step that can succeed while producing nothing is worse than one that
fails loudly, because it destroys the previous good copy on its way past.
