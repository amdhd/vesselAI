# Kubernetes & EKS — Interview Prep Knowledge Base

> Companion to [`interview-prep.md`](interview-prep.md), which covers the application. This one covers the platform: nine phases from a laptop k3d cluster to a real EKS cluster built from an empty AWS account, deployed by Argo CD.
>
> Everything here is from work that was actually done and verified — the failures are real failures with their real symptoms, and the numbers are measured. Where something is unproven or was deliberately skipped, it says so. Being able to say *"here is the boundary of what I demonstrated"* is worth more in an interview than a confident overclaim someone can puncture with one question.

---

## 1. Elevator pitch (30 seconds)

I migrated a full-stack app — Express/Prisma/Postgres API, React frontend, a Python analytics service, a background worker, and batch jobs — onto Kubernetes, then onto EKS.

**The same manifests deploy to both clusters**: one Kustomize base with a dev overlay for k3d and a prod overlay for EKS. Terraform builds the AWS side from an empty account in about 20 minutes — VPC, EKS 1.36, IRSA for four controllers, an ALB with an ACM certificate, KMS-encrypted Secrets — and `make destroy` removes it, including the ALB and EBS volumes that Terraform does not own.

**The interesting part is what broke.** Rebuilding from nothing surfaced nine bugs a laptop cluster could not, six of them because earlier phases had built resources by hand before Argo CD arrived — which meant the repo could not deploy itself from an empty cluster. One of them proved the NetworkPolicy was genuinely enforced, by returning 504 while every pod was healthy.

---

## 2. Cluster map

| | k3d (local) | EKS (AWS) |
|---|---|---|
| Cluster | k3s v1.35.5, 1 server + 2 agents | EKS 1.36, 3× t3.medium, managed node group |
| Ingress | Traefik (bundled with k3s) | AWS Load Balancer Controller → **one shared ALB** |
| TLS | Traefik self-signed | ACM wildcard, browser-trusted |
| Storage | local-path | gp3 via EBS CSI, encrypted |
| DNS | `localhost` + paths | external-dns → Route 53, host-based |
| Secrets | Sealed Secrets | Sealed Secrets **+** KMS envelope encryption |
| Autoscaling | HPA only | HPA **+** Cluster Autoscaler |
| Cost | free | ~$0.28/hr |

**Why two clusters rather than one.** k3d is the fast loop — a rebuild is seconds and costs nothing. EKS is where the assumptions get tested. Nearly everything interesting in section 7 was invisible locally.

---

## 3. The three workload shapes

The single most useful framing for "explain your architecture": Kubernetes treats three kinds of workload very differently, and this project has all three.

| Shape | Object | Why | Here |
|---|---|---|---|
| Stateless web | `Deployment` | Interchangeable replicas, rolling updates, scale freely | api, web, analytics |
| Stateful data | `StatefulSet` | Stable identity + stable storage, ordered start/stop | postgres |
| Batch / stream | `Job`, `CronJob`, `Deployment` | Run-to-completion vs. always-on-but-no-HTTP | db-init, pg_dump backup, warehouse refresh, AIS worker |

### Why Postgres is a StatefulSet, not a Deployment

The question you will be asked, and the honest answer:

- **Stable network identity.** `postgres-0` always resolves to the same pod through the headless Service. A Deployment gives random pod names, so nothing can reliably address "the primary".
- **Stable storage.** `volumeClaimTemplates` creates one PVC *per replica*, and that PVC is re-attached to the same ordinal on reschedule. A Deployment's `volumes` are shared or ephemeral.
- **Ordered operations.** Replicas start and terminate in order, which matters the moment replication exists.

**The boundary to volunteer:** a StatefulSet gives identity and storage, **not replication**. Scaling `replicas: 3` gives three independent, empty databases — not a cluster. Real replication needs an operator (CloudNativePG) or a managed service. Production answer is RDS.

**What happens to the PVC when the pod is deleted?** It survives — that is the point. The PVC has its own lifecycle, bound to the ordinal, not the pod. Deleting the *StatefulSet* does not delete the PVCs either; you have to remove them explicitly. That is deliberate, and it is why a `reclaimPolicy` decision matters (section 6).

---

## 4. The deep dives

### 4.1 IRSA — the one they will actually probe

**The problem.** A pod needs to call an AWS API. Without IRSA the only credential available is the **node's** instance profile, so every pod on that node shares one identity. Grant the EBS CSI driver permission to delete volumes and you have granted it to the API pod too. No per-workload scoping at all.

**The chain, in order:**

1. The cluster publishes an **OIDC issuer** — an HTTPS endpoint serving signed JWTs and the keys to verify them. EKS creates it.
2. `aws_iam_openid_connect_provider` **registers that issuer in IAM**. *This is the step people forget.* Without it the issuer exists, IAM has never heard of it, and every `AssumeRoleWithWebIdentity` is rejected by an error that does not mention the missing provider.
3. An IAM role's **trust policy** names that provider and pins two conditions: `aud = sts.amazonaws.com`, and `sub = system:serviceaccount:<namespace>:<name>`.
4. The **ServiceAccount is annotated** `eks.amazonaws.com/role-arn: <role>`.
5. A **webhook injects** `AWS_ROLE_ARN` and `AWS_WEB_IDENTITY_TOKEN_FILE` plus a projected token. Any AWS SDK picks these up and calls `sts:AssumeRoleWithWebIdentity`. **Nothing in the application changes.**

**The `sub` condition is the whole game.** Omit it and the role still works — it is simply assumable by *any* service account in the cluster, because every pod holds a token from that issuer. The role working is exactly why the omission survives code review.

**IRSA is IAM, not RBAC.** They are separate systems answering different questions:

- **RBAC**: may this identity call the *Kubernetes* API? (`get pods`, `patch deployments`) — enforced by the API server.
- **IRSA**: may this pod call the *AWS* API? (`CreateLoadBalancer`, `DeleteVolume`) — enforced by STS and IAM.

A pod can hold `cluster-admin` and no AWS access, or `AdministratorAccess` and no permission to list pods. **The AWS Load Balancer Controller needs both** — RBAC to watch Ingress objects, IRSA to create the ALB. Wire one and not the other and you get a controller that runs happily and silently accomplishes nothing.

**Four consumers here:**

| Workload | Namespace | Scope of its IAM policy |
|---|---|---|
| EBS CSI driver | `kube-system` | AWS-managed `AmazonEBSCSIDriverPolicy` |
| Load balancer controller | `kube-system` | **Vendored upstream** — 80 actions, 10 on `Resource: "*"` |
| Cluster Autoscaler | `kube-system` | **Hand-written**: broad discovery, mutation conditioned on an ASG tag |
| external-dns | `external-dns` | **Hand-written**: writes scoped to one hosted zone |

**Be honest about the vendored one.** It is not least privilege. `terraform/policies/README.md` says so, names the 13 actions that are dead weight here (`shield`, `waf-regional`, `wafv2`, `cognito-idp`), and explains why they are still present — the controller's behaviour when a preflight call is denied is version-specific, and a subtle reconcile failure is expensive to debug. Saying *"I know exactly which permissions are unnecessary and why I left them"* is a stronger answer than pretending it is tight.

**The autoscaler policy is the one to show off.** Discovery has to be broad — it cannot know which ASGs carry its tags without listing all of them — but `SetDesiredCapacity` and `TerminateInstanceInAutoScalingGroup` are conditioned on `aws:ResourceTag/k8s.io/cluster-autoscaler/<cluster> = owned`. So it can *see* every ASG in the account and *resize* only this cluster's.

**Same mechanism, different issuer: GitHub Actions → ECR.** Subject is `repo:<owner>/<name>:ref:refs/heads/main`, principal is a workflow run rather than a pod. Pinned with `StringEquals` on the full subject — `repo:owner/*` would let any repo in the account assume it, and a trailing wildcard on the ref would let a fork's pull request push to your registry.

### 4.2 Probes — liveness vs readiness

The distinction, and the failure that motivated getting it right:

- **Liveness**: "is this process wedged?" Failure → **restart the container**.
- **Readiness**: "should this pod receive traffic?" Failure → **remove from the Service endpoints**, no restart.

**Readiness tests the database; liveness deliberately does not.**

`/api/ready` runs `SELECT 1`. Prisma connects lazily, so a pod whose database was unreachable used to answer `/api/health` with 200 — it reported Ready, took traffic, and 500'd it.

**The failure that makes this more than cosmetic is a rolling update.** If new pods cannot reach Postgres — bad secret, NetworkPolicy, wrong host — a liveness-style check passes, Kubernetes marks them Ready, and **retires the healthy old pods**. A readiness probe that tests the dependency stalls the rollout instead and leaves the working pods in place.

**Why liveness must NOT check the database:** a liveness probe that fails during a database outage restarts every pod in a loop, turning a dependency outage into an application outage and discarding warm connection pools exactly when reconnecting is most expensive.

**A detail worth mentioning:** both probe endpoints sit *above* the rate limiter. Probes arrive from the kubelet's node IP; readiness every 10s plus liveness every 20s is ~135 requests per 15-minute window against a limit of 200. Two thirds of that IP's budget on health checks — and a 429 returned to a probe reads as "unhealthy" and restarts a container that was fine.

### 4.3 Migrations — a Job, not an initContainer

**The naive version** puts `prisma migrate deploy` in an initContainer on the API. With `replicas: 3` that is three concurrent migrations against one database.

- Prisma takes an advisory lock, so it is not corruption — one pod applies, the others wait and report "No pending migrations".
- **But lock waits time out.** Three fast migrations on a laptop is the easy case; a slow migration under contention is not.
- And a **failing** migration means no initContainer succeeds, so no pod becomes Ready, so nothing serves — with the error buried in an init container's logs.

**The fix** is a `Job` that gates the rollout. One pod, run to completion, `backoffLimit` bounded. Under Argo CD it is a sync hook so the ordering is enforced by the deployment tool rather than by hoping.

**The Prisma CLI is a devDependency and `Dockerfile.prod` prunes it**, so the Job uses the `build` stage rather than the runtime image. Worth naming rather than silently shipping a fatter image.

### 4.4 HPA, metrics-server, and the measured numbers

- HPA scales **pods**; Cluster Autoscaler scales **nodes**. Both are needed, and the second was missing at first — `node_max_size = 5` was a number no process could act on.
- **k3s ships metrics-server; EKS does not.** Without it the HPA reports `<unknown>/70%` forever, which reads as a broken autoscaler rather than a missing metrics source. Installed as a managed addon.
- **The HPA owns `/spec/replicas`.** The prod overlay deliberately does *not* declare `replicas`, because Argo CD would otherwise fight the autoscaler — and there is an `ignoreDifferences` entry for exactly that.

**Measured on EKS**, k6 running inside the cluster (see 4.10 for why):

| | k3d | EKS |
|---|---|---|
| Throughput | 473.6 req/s | 227.1 req/s |
| p95 | 11.0 ms | 287.5 ms |
| Replicas | 3 → 8 | 3 → 10 |
| Failures / 429s | 0 / 0 | 0 / 0 |

```
t+040s  cpu=14%   desired=7   ready=3     <- HPA reacts
t+070s  cpu=188%  desired=10  ready=10    <- ~30s decision to Ready
t+150s  cpu=60%   desired=10  ready=10    <- converged on the 60% target
t+180s  cpu=3%    desired=10  ready=10    <- load gone, replicas HELD
```

**The last line is the one to point at.** Load stopped and replicas stayed at 10 — that is the 300s scale-down stabilisation window. Scale-up is deliberately fast and scale-down deliberately slow, because flapping is worse than briefly over-provisioned.

**Why EKS is slower, stated plainly rather than hidden:** t3.medium is *burstable* (baseline 20% of 2 vCPU — a sustained run drains CPU credits and throttles), pod-to-pod hops cross an AZ instead of loopback, and Postgres is on EBS rather than laptop NVMe. For numbers that measure the application rather than the credit balance, use `c5.large` — non-burstable, about the same price.

### 4.5 NetworkPolicy — and how it was finally proven

**Default-deny in the namespace, then explicit allows.** Only the API, worker and batch tier may reach Postgres.

**The critical caveat: enforcement depends on the CNI.** A NetworkPolicy that is silently ignored looks *identical* to one that works. On EKS the VPC CNI ignores NetworkPolicy entirely unless `enableNetworkPolicy` is set on the addon.

**How it got proven.** After deploying, the site returned **504 over a valid TLS endpoint while every pod was `1/1 Ready`**. Target groups showed `Target.Timeout` for api and web — while **Grafana was healthy**, in the one namespace with no NetworkPolicy. That contrast is the diagnosis.

With `alb.ingress.kubernetes.io/target-type: ip`, the ALB connects from **its own ENIs in the public subnets** straight to the pod IP. The source is not a pod, so no `podSelector` or `namespaceSelector` can ever match it, and default-deny dropped the traffic — health checks included.

The fix is an `ipBlock` scoped to the **two public subnets**, not the VPC. `10.0.0.0/16` would also let every node and every pod in the private subnets reach the API directly, which is most of what default-deny exists to prevent.

> If asked "how do you know your NetworkPolicy works?" — the answer is not "I applied it." It is "it broke my ingress and I could explain why."

### 4.6 Secrets — Sealed Secrets and KMS

**Sealed Secrets** lets encrypted secrets live in a public git repo. The controller holds an RSA private key *in the cluster*; `kubeseal` encrypts with the public half. The ciphertext is safe to commit — that is the entire point.

**The boundary to state:** this protects **git**, not the cluster. Anyone with `get secrets` in the namespace reads the decrypted value. RBAC is what limits that.

**The failure that bites on every new cluster:** a SealedSecret is encrypted to **one** controller's keypair. A fresh cluster generates a new one, so secrets sealed against k3d cannot be decrypted on EKS. **And it fails silently** — the SealedSecret applies cleanly, `kubectl get sealedsecret` looks healthy, only the controller log mentions decryption, and pods sit in `CreateContainerConfigError` waiting on a Secret that is never created.

The re-seal script generates *fresh* `POSTGRES_PASSWORD` and `JWT_SECRET` rather than copying the laptop's — reusing a development database password on an internet-facing cluster makes one compromise into two. **And it is a per-cluster sweep, not a per-app step**: Grafana's secret was missed on the first pass for exactly that reason.

**KMS envelope encryption** is the second layer. EKS encrypts etcd with an AWS-owned key by default; envelope encryption wraps each Secret's data key with a key in *your* account, so reading etcd is not enough — an attacker also needs `kms:Decrypt`, which CloudTrail records.

> **One-way door.** Encryption can be enabled on an existing cluster but never disabled, and destroying the key makes every Secret unreadable. Worth saying out loud — it shows you read the operational note, not just the feature list.

### 4.7 The Ingress chain, and the ALB

**Say this chain explicitly; it is the thing people wave at:**

```
browser
  -> Ingress CONTROLLER (a real pod that listens on a port and proxies)
  -> Ingress OBJECT (only a rule — no process behind it)
  -> Service (stable virtual IP + DNS)
  -> EndpointSlice (pod IPs currently passing READINESS)
  -> Pod
```

**An Ingress object with no controller does nothing, silently.** So does one whose `ingressClassName` nothing claims. The EndpointSlice link is why readiness probes decide routing.

**On EKS specifically:**

- `target-type: ip` sends traffic straight to pod IPs. `instance` routes via a NodePort on every node and lets kube-proxy hop again — an extra hop, and the ALB health-checks the *node* rather than the pod.
- **`group.name` puts app + Grafana on one ALB.** Without it, every Ingress object provisions its own load balancer — three at ~$16/month each. Largest avoidable cost in the ingress layer.
- **No `certificate-arn` annotation, on purpose.** The controller discovers a matching ACM cert from the `host`. Pinning the ARN works until the cluster is rebuilt — the ARN carries a UUID that changes every apply, and it fails at ALB creation rather than at render.
- **Health checks are per-Ingress, not per-backend** — but Service-level annotations override per target group. Four backends do not share an endpoint: web serves `/`, the API **404s on `/`** and answers `/api/ready`, analytics serves `/health`. One shared `/` left api and analytics at `Target.Timeout`.

### 4.8 GitOps — Argo CD, sync waves, drift

**Push vs pull, honestly:** push-based CI (`kubectl apply` from a workflow) is simpler and what many real shops do. Pull-based gives drift detection and keeps cluster credentials out of CI. This project took pull.

**Sync waves order the apply; Argo gates each wave on health.** The rule that falls out of four separate bugs:

> **A resource must not sync earlier than whatever its *health* depends on.**

A wave-0 resource whose health depends on wave 2 blocks the sync **permanently**, not transiently.

| Resource | Depends on |
|---|---|
| `db-init` hook | ServiceAccount, Secret, a running database |
| `postgres-backups` PVC | a consumer to bind against |
| `api` HPA | its target Deployment |

**`selfHeal: false` is deliberate here**, and worth being able to defend. Self-heal issues *partial* syncs scoped to the drifted resource, which bypasses the PreSync/wave ordering — so a drift correction could start the API against an unmigrated database. The cost: Argo *detects* drift (`OutOfSync`) without correcting it, and an explicit sync is needed. Both behaviours were observed during the load test, when a hand-patched ConfigMap was reverted by an unrelated merge but not by drift alone.

**Three independent allow-lists** bound what Argo can do, and adding a cluster-scoped kind means updating all three — each failing differently and none naming the others:

| Gate | Bounds | Failure message |
|---|---|---|
| `resource.inclusions` | what Argo **watches** | `excluded in the settings` — a **warning**, while the app claims `Healthy` |
| Controller ClusterRole | what Argo **can do** | forbidden at sync |
| AppProject whitelist | what an **Application may deploy** | `not permitted in project` |

The first is the dangerous one: **healthy-but-not-working**.

### 4.9 Storage on EKS

- **gp3, not the default gp2.** EKS ships a `gp2` class on the *in-tree* provisioner with `allowVolumeExpansion: false`. A PVC naming no class lands there — legacy, unexpandable, and unencrypted unless the account default says otherwise.
- **`volumeBindingMode: WaitForFirstConsumer` is the most important field.** With `Immediate`, the volume is provisioned in whatever AZ the controller picks; if the scheduler later places the pod in the *other* AZ, the pod can never start. The symptom is `volume node affinity conflict`.
- **But it is wrong for a CronJob-only volume.** Nothing claims `postgres-backups` between scheduled runs, so it stays `Pending` — and Argo treats a Pending PVC as unhealthy and blocks the wave **forever**. That one needs `Immediate`. The rule: `WaitForFirstConsumer` when a running workload backs the claim, `Immediate` when only a CronJob does.
- **EBS is AZ-pinned, inherently.** `WaitForFirstConsumer` fixes *first* start. It does not survive node loss — once the volume exists, the pod can only reschedule into that same AZ. Real answers are RDS Multi-AZ or CloudNativePG; a StatefulSet plus an EBS volume is neither, and adding replicas does not make it one.
- **`reclaimPolicy: Delete`** here, which would be wrong for a production database and is right for a burst cluster: an unattached EBS volume bills forever and is invisible to `terraform destroy`.

### 4.10 Supply chain

- **Immutable tags, by commit SHA, never `:latest`.** A running pod's image names the exact commit that built it, and rollback is "deploy the previous SHA" rather than "hope the registry still has what `:latest` used to point at."
- **Prod pins by digest, not tag.** A tag is a pointer someone can move; a digest *is* the content. Two nodes pulling the same tag can get different bytes.
- **Trivy in CI, failing on HIGH/CRITICAL, with `ignore-unfixed`.** A CRITICAL with no available patch is not something the pipeline can act on, and failing on it trains everyone to ignore the scanner — the worst outcome for a gate.
- **ECR `scan_on_push` complements Trivy** rather than duplicating it: Trivy blocks the build, ECR re-scans what is stored — which is how you learn about a CVE published *after* the image shipped.
- **The honest gap, which bit for real:** nothing writes the resulting digest back into the overlay. The pinned images predated `/api/ready`, so every API pod deployed and failed readiness with a 404 on an endpoint the running image had never had. **Pinning by digest makes deployments reproducible; it does not make them current.** Argo CD Image Updater or a CI commit step closes it.

---

## 5. Tradeoffs & decision summaries

| Decision | Chose | Rejected | Why / when the other wins |
|---|---|---|---|
| Postgres | StatefulSet in-cluster | Deployment; RDS | Identity + per-replica storage. RDS is the production answer — named in the README rather than pretended otherwise. |
| Migrations | Gating `Job` (Argo sync hook, wave 1) | initContainer on the API | Three replicas = three concurrent migrations; a failure means nothing becomes Ready and the error hides in init logs. |
| Readiness probe | Tests the DB (`/api/ready`) | Same endpoint as liveness | Otherwise a rollout retires healthy pods for new ones that cannot reach the database. |
| Liveness probe | Does **not** test the DB | Symmetry with readiness | A DB outage would restart every pod in a loop and discard warm pools. |
| Node type | 3× t3.medium | 2× t3.large | Same vCPU each; large only adds RAM, the resource already in surplus. Measured peak is 5.30 CPU — 2× large gives 3.86 allocatable and does **not** fit. Three mediums are cheaper, fit, and give a third node to drain. |
| Pod density | Prefix delegation on the VPC CNI | Default | t3.medium allows only 17 pods/node; 3 nodes = 51 slots against a ~57 peak. Would exhaust **IP addresses** before CPU, presenting as Pending pods with CPU free. |
| Ingress TLS | ACM cert discovered from `host` | Pinned `certificate-arn` | The ARN carries a UUID that changes every rebuild, and fails at ALB creation rather than at render. |
| VPC lookup | `--aws-vpc-tags=Name=…` | Hardcoded `--aws-vpc-id` | Tag is derived from `cluster_name` and survives rebuilds; a VPC id is generated. **Rejected fix worth naming:** raising the IMDS hop limit to 2 would remove the flag entirely — by deleting the control that stops an SSRF stealing node credentials. |
| Ingress count | One ALB via `group.name` | One ALB per Ingress | 3 × ~$16/month for no benefit. |
| Argo self-heal | Off | On | Self-heal issues partial syncs that bypass wave ordering — a drift correction could start the API against an unmigrated DB. Cost: drift detected, not corrected. |
| Cluster controllers | **Not** under GitOps | Adopt them | Would need Argo granted `kube-system` plus admission-webhook management cluster-wide. On a permanent cluster the answer flips, under a separate AppProject. |
| Argo CD exposure | port-forward only | Public Ingress | It is the deployment control plane, protected by a generated default password. Publishing it needs rotation + SSO, not just an Ingress. |
| Node autoscaling | Cluster Autoscaler | Karpenter | Karpenter is the better tool and what a new cluster would generally pick — it also *replaces* the managed node group, discarding the nodes this project wanted for drain/cordon demos. **Scope, not merit.** |
| Third-party installs | Upstream plain YAML, vendored | Helm | Keeps one unfamiliar abstraction at a time. **Real cost:** the LB controller's plain bundle needs cert-manager for its webhook cert, which the chart would have generated itself. |
| Terraform state | Local | S3 + DynamoDB | One person, three days, no concurrent applies. The boundary: `terraform.tfstate` is the only record of what exists — which is when `check-orphans` stops being paranoia. |
| NAT gateways | One | One per AZ | $0.045/hr vs $0.09. The trade: an AZ-a outage removes egress for AZ-b's nodes too. |

---

## 6. The nine bugs — the best material you have

Interviewers ask "tell me about something that broke." These are real, with real symptoms. **Six existed because Phases 1–6 built resources by hand before Argo CD arrived** — nothing ever had to create its own preconditions, so the repo could not deploy itself from an empty cluster. That framing is the story.

| # | Symptom | Root cause | Why k3d hid it |
|---|---|---|---|
| 1 | Sync hangs on `db-init` forever | PreSync hook needs a ServiceAccount, Secret and database — all Sync-phase. Deadlock. | They already existed |
| 2 | App `Healthy`, every PVC `Pending` | StorageClass blocked by three allow-lists; the first fails as a **warning** | Dev overlay has no StorageClass |
| 3 | Argo controller `CrashLoopBackOff` with a nil-pointer panic | Could not create the `prometheus` ClusterRole (privilege escalation); upstream error path dereferences nil | The role pre-existed, so Argo only *adopted* it |
| 4 | Sync fails: "unable to get the target's current scale" | HPA at wave 0, its Deployment at wave 2 | Ordering never forced |
| 5 | Sync blocked on a Pending PVC indefinitely | CronJob-only volume under `WaitForFirstConsumer` — nothing ever claims it | local-path binds immediately |
| 6 | Grafana `CreateContainerConfigError` | SealedSecret never re-sealed for the new cluster | Same key, same cluster |
| 7 | All API pods `0/1` forever, probe returns 404 | Pinned digests **predated `/api/ready`** | Images and manifests moved together |
| 8 | **504 with every pod `1/1 Ready`** | NetworkPolicy denied the ALB — not a pod, so no selector matches | k3s CNI; Traefik is an in-cluster pod |
| 9 | api + analytics `Target.Timeout`, web healthy | `/` is not a shared health endpoint — API 404s on it | Traefik health-checks differently |

**Two more were self-inflicted and worth telling anyway**, because finding your own bugs is the point: external-dns had a duplicate `--txt-owner-id` flag (fatal, and it surfaced as a *stuck terraform apply* rather than anything mentioning a flag) **and** the wrong namespace in its trust policy. The crash was hiding the subtler bug underneath it — the trust policy would have failed silently long after the crash was fixed.

**A third:** `make destroy` could not run non-interactively (`error asking for approval: EOF`) — and it failed *after* deleting every namespace, leaving the app gone and the infrastructure still billing. The exact state the target exists to prevent, reached by the target itself.

### The pattern worth naming out loud

Most of these share a shape: **something worked because of history, not because it was correct.** Rebuilding from an empty account is what separates the two. If asked what you would do differently, "test the bootstrap path, not just the steady state" is a genuinely good answer.

---

## 7. Cost / FinOps

| Line item | $/hr |
|---|---|
| EKS control plane | 0.100 |
| 3× t3.medium | 0.125 |
| NAT gateway | 0.045 |
| ALB + public IPv4 + EBS | ~0.06 |
| **Total** | **~$0.28** |

- **The control plane is a floor**: $73/month whether or not a single pod runs.
- **Spot** would cut the node line ~68% ($0.0268 vs $0.0416/hr) — and interruptions are a *free* PodDisruptionBudget demo. Not used during bring-up, because a spot reclaim mid-debug produces failures that look exactly like your own bug.
- **The teardown order is the real cost control.** The ALB is created by a controller from an Ingress; the PVC volumes by the CSI driver from a PVC. **Neither is in Terraform state.** `terraform destroy` alone leaves both billing and then hangs the VPC delete on the orphaned ENIs. `make destroy` deletes namespaces first — the finalizers are what actually remove the AWS objects — then runs Terraform, then `check-orphans` verifies.
- **One residual charge is unavoidable:** a KMS key enters a 7-day pending-deletion window and bills ~$1/month until it goes. Seven days is AWS's minimum.

---

## 8. Command cheat sheet

```bash
# Where is it actually broken?
kubectl get pods -n vesselmind                       # phase + restarts
kubectl describe pod <pod> -n vesselmind             # Events at the bottom
kubectl logs <pod> -n vesselmind --previous          # the CRASHED container
kubectl get events -n vesselmind --sort-by=.lastTimestamp

# The Ingress chain, middle out
kubectl get ingress -A
kubectl get endpointslice -n vesselmind              # empty = readiness failing
kubectl -n kube-system logs deploy/aws-load-balancer-controller

# Scheduling
kubectl get nodes -o jsonpath='{.items[*].status.allocatable.pods}'   # 110 = prefix delegation on
kubectl describe node <node> | grep -A5 Allocated
kubectl get events --field-selector reason=FailedScheduling

# IRSA, end to end
kubectl get sa <sa> -n <ns> -o yaml | grep role-arn
kubectl get pod <pod> -o jsonpath='{.spec.containers[0].env}'         # AWS_ROLE_ARN injected?
aws iam get-role --role-name <role> --query 'Role.AssumeRolePolicyDocument'

# Argo
kubectl -n argocd get applications
kubectl -n argocd get application <app> -o jsonpath='{.status.conditions}'
kubectl -n argocd annotate application <app> argocd.argoproj.io/refresh=hard --overwrite

# Storage
kubectl get pvc -A                                   # Pending = no consumer, or no class
kubectl get storageclass

# Prove the NetworkPolicy
kubectl run probe --rm -it --image=curlimages/curl -n <ns> -- sh   # needs a PSS-compliant securityContext
```

---

## 9. Mock interview Q&A bank

### Screening

**"Walk me through what you deployed."**
A six-module full-stack app — API, frontend, Python analytics service, background worker, and batch jobs — on Kubernetes, from a local k3d cluster to EKS built from an empty AWS account by Terraform. Same Kustomize base, two overlays. Argo CD deploys from git. The interesting part was rebuilding from nothing: it surfaced nine bugs a laptop cluster could not, including a deadlock that meant the repo could not actually deploy itself.

**"Why Kubernetes for this at all?"**
Honestly? For this workload, Docker Compose or ECS would be enough. The project exists to demonstrate that I can operate and debug a cluster. I would say the same to a customer: if you have three services and no scaling story, Kubernetes is a cost. The value shows up with many services, real autoscaling, and a platform team.

### Deep dives

**"Explain IRSA to someone who knows IAM but not Kubernetes."**
→ Section 4.1. Lead with the *problem* (node identity is shared by every pod), then the chain, then the `sub` condition being what makes it per-workload, then that IRSA is IAM and not RBAC.

**"How do you know your NetworkPolicy is enforced?"**
Not by applying it. On EKS the VPC CNI ignores NetworkPolicy unless you enable it on the addon — a silently-ignored policy looks identical to a working one. I know mine is enforced because **it broke my ingress**: 504 with every pod Ready, api and web target groups timing out, and Grafana healthy in the one namespace with no policy. The ALB connects from its own ENIs, not from a pod, so no selector could match it.

**"Your pods are Pending but the nodes have free CPU and memory. Why?"**
Most likely IP addresses. Max-pods on EKS is a function of instance type, not memory: `ENIs × (IPs per ENI − 1) + 2`. t3.medium is 17. Three nodes gives 51 slots and this cluster peaks near 57. Prefix delegation raises it to 110. Check `kubectl describe node` for allocatable pods before assuming it is resources.

**"A Deployment rollout took the site down. What went wrong?"**
Almost certainly the readiness probe did not test what the pod actually needs. If readiness only checks that the process is up, Kubernetes marks new pods Ready, retires the old ones, and *then* they fail. That is why our readiness runs `SELECT 1` and liveness deliberately does not — a liveness probe that fails on a database outage restarts every pod in a loop.

**"Why is your Postgres a StatefulSet? Does that make it highly available?"**
→ Section 3. Identity and storage, **not** replication. Three replicas would be three empty databases. Production answer is RDS.

**"Walk me through your GitOps setup and one thing it got wrong."**
Argo CD, pull-based, syncing Kustomize overlays. `selfHeal` is off on purpose — it issues partial syncs that bypass wave ordering, so a drift correction could start the API against an unmigrated database. What it got wrong: the migration Job was a PreSync hook that needed a ServiceAccount, a Secret and a database, all Sync-phase. It worked locally only because those already existed. Sync waves fixed it.

**"How do you keep the cloud bill down?"**
One NAT instead of one per AZ, one ALB shared across three Ingresses via `group.name`, node type chosen from *measured* demand rather than guessed, and a `make destroy` written on day one. The subtle part is teardown order: the ALB and the PVC volumes are created by controllers, not Terraform, so `terraform destroy` alone leaves them billing and then hangs on their ENIs.

**"What is the least-privilege story for your controllers?"**
Mixed, and I would rather say so. external-dns and the autoscaler are hand-written and tightly scoped — the autoscaler can *see* every ASG but only *resize* ones tagged for this cluster. The load balancer controller's policy is vendored upstream: 80 actions, 10 on `Resource: "*"`. I documented exactly which 13 actions are unnecessary here and why I left them rather than pretending it is tight.

### Behavioural / judgment

**"Tell me about a bug that took a long time to find."**
external-dns crash-looping with `flag 'txt-owner-id' cannot be repeated`. Two things made it hard: the addon sets that flag itself so my `extraArgs` duplicated it, and the failure surfaced as a **stuck `terraform apply`** — nothing in Terraform's output mentioned a flag. Finding it meant reading the pod log. And the crash was hiding a second bug: the trust policy pinned the wrong namespace, which would have failed silently long after the crash was fixed.

**"What would you do differently?"**
Test the bootstrap path, not just the steady state. Most of my bugs existed because things worked *because of history* — resources created by hand before the deployment tool arrived. Rebuilding from an empty account is the only thing that separates "correct" from "happens to work."

**"What is not production-ready here?"**
Postgres in-cluster on AZ-pinned EBS with no replication; no alerting, only dashboards; image digests bumped by hand; Argo CD reachable only by port-forward; cluster controllers outside GitOps; local Terraform state. Each is a deliberate scope decision with the production answer named, not an oversight.
