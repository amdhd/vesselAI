# Running VesselMind on EKS

Phase 9. The cluster is a **burst** cluster: built, demonstrated, destroyed.
It costs roughly **$0.28/hour** while it exists, so the teardown at the bottom
is not an afterthought — it is the most important section on this page.

## What Terraform owns, and what it cannot

`terraform/` builds the cluster from an empty AWS account: VPC, ECR, EKS 1.36,
a managed node group, five IRSA roles, an ACM wildcard certificate, and KMS
envelope encryption for Secrets. It also installs every component available as
a **managed EKS addon** — VPC CNI, EBS CSI, metrics-server, cert-manager,
external-dns — and wires their IRSA annotations.

Two things it deliberately does not own:

- **The ALB and the PVC volumes.** Created by controllers in response to
  Kubernetes objects, never in Terraform state. This is why `make destroy`
  deletes namespaces *before* running `terraform destroy`, and why
  `make check-orphans` exists.
- **Controllers with no addon.** The AWS Load Balancer Controller, Cluster
  Autoscaler and Sealed Secrets are vendored in `k8s/aws/` because there is no
  managed addon for them. Terraform creates their IAM roles only.

## Bootstrap, in order

The order is load-bearing. Each step explains what breaks if it runs early.

### 1. Credentials

```bash
aws login --profile vesselmind
export AWS_PROFILE=vesselmind-tf
```

Note the **`-tf` suffix** — that is a second profile that exists solely so
Terraform can read the session:

```ini
[profile vesselmind-tf]
credential_process = aws configure export-credentials --profile vesselmind --format process
region = us-east-1
```

**Why a wrapper profile rather than the obvious `eval`.** `aws login` caches
credentials in a location only the AWS CLI reads. Terraform uses the AWS Go SDK,
which does not know about that cache, so pointing it at `vesselmind` directly
fails with "No valid credential sources found" despite a perfectly valid
session. The documented workaround is:

```bash
eval "$(aws configure export-credentials --profile vesselmind --format env)"   # don't
```

That works and is a trap. It exports a **frozen snapshot** with a fixed expiry,
and a full apply takes 15–20 minutes. Both apply attempts during this phase died
partway through when the snapshot expired:

```
Error: waiting for EKS Node Group create: ExpiredTokenException
Error: waiting for EKS Add-On (aws-ebs-csi-driver) create: ExpiredTokenException
```

Neither was an infrastructure failure — AWS created the resources fine, and
Terraform lost the ability to poll them, leaving a tainted node group and four
addons missing from state. Recovering meant `terraform untaint` and a reconcile
apply, twice.

`credential_process` is a mechanism the **SDK** understands: instead of holding a
snapshot, it re-invokes the CLI whenever it needs a credential, so a long apply
refreshes itself. Set the profile once and no `eval` is ever needed again.

### 2. Infrastructure

```bash
terraform -chdir=terraform init
terraform -chdir=terraform plan
terraform -chdir=terraform apply
aws eks update-kubeconfig --name vesselmind --region us-east-1 --profile vesselmind
```

Pass `--profile` to `update-kubeconfig`. Without it the kubeconfig writes an
exec entry with no profile, and `kubectl` in a fresh shell falls back to your
default profile — which is probably a different account or an expired session.

Roughly 15–20 minutes; the control plane alone is ~10.

**Verify before continuing.** `--max-pods` is computed at node bootstrap, so if
the node group somehow came up before the VPC CNI was configured, prefix
delegation did not take:

```bash
kubectl get nodes -o jsonpath='{.items[*].status.allocatable.pods}'
```

Expect `110 110 110`. If it says `17`, recycle the node group — three nodes at
17 pods gives 51 slots against a peak of ~57, and you will hit IP exhaustion
that presents as Pending pods with CPU and memory visibly free.

### 3. Cluster controllers, by hand

```bash
kubectl apply -k k8s/aws/sealed-secrets
kubectl apply -k k8s/aws/cluster-autoscaler
kubectl apply -k k8s/aws/load-balancer-controller   # will partially fail
kubectl apply -k k8s/aws/load-balancer-controller   # run it twice
kubectl -n kube-system rollout status deploy/aws-load-balancer-controller
```

**The load balancer controller apply must be run twice**, and the first failure
is expected:

```
error: resource mapping not found for kind "IngressClassParams" ... ensure CRDs are installed first
```

The bundle defines that CRD *and* an instance of it in one file, and kubectl
cannot use a CRD it is creating in the same pass. The second apply succeeds.
Argo CD handles this on its own with retries, which is why it only bites during
manual bootstrap.

**Why the controller is told its VPC at all**, since that looks like something
it should discover: by default it asks the EC2 instance metadata service. The node group sets `HttpPutResponseHopLimit = 1`, which stops **pods**
reaching IMDS — deliberately, because that is what prevents an SSRF in any pod
from stealing the node's IAM credentials. It is the recommended posture for a
cluster using IRSA, and it breaks the controller's default:

```
unable to initialize AWS cloud: failed to get VPC ID: ec2imds: GetMetadata, context deadline exceeded
```

The controller then never starts, so no Ingress is reconciled and no ALB
appears — while the Ingress object shows nothing wrong. Nothing is
misconfigured here; correct hardening broke a default, which is its own
category of failure and worth recognising as such.

It is told **by tag** (`--aws-vpc-tags=Name=vesselmind-vpc`) rather than by id.
The Name tag is derived from `cluster_name` in `terraform/vpc.tf`, so it is
deterministic and needs no edit when the cluster is rebuilt — unlike the VPC id,
which is generated fresh each time. Nothing in this bootstrap requires updating
a generated value by hand.

**Why by hand and not via Argo CD.** The load balancer controller is what turns
Ingress objects into an ALB — including the Ingress that Argo CD's own UI is
served on. It has to be running before Argo CD is reachable by hostname. This
is the ordinary chicken-and-egg of GitOps bootstrap, not a workaround: Argo
adopts existing resources cleanly, so applying by hand now and letting the
`vesselmind-cluster-components` Application take ownership later produces the
same end state with no drift.

If the load balancer controller will not start, check cert-manager first. The
plain-YAML bundle ships a cert-manager `Issuer` and `Certificate` for its
admission webhook, and the resulting errors never mention cert-manager:

```bash
kubectl -n kube-system logs deploy/aws-load-balancer-controller
kubectl get certificate -A
```

### 4. Re-seal the secrets

```bash
export ANTHROPIC_API_KEY=sk-ant-...
./k8s/scripts/reseal-for-eks.sh
git add k8s/overlays/prod/sealedsecret-patch.yaml && git commit && git push
```

A SealedSecret is encrypted to **one** controller's key, and this cluster
generated a new one. `k8s/base/02-sealedsecret.yaml` was sealed against k3d and
cannot be decrypted here.

The failure is silent, which is the whole reason this is a numbered step: the
SealedSecret applies cleanly, `kubectl get sealedsecret` looks healthy, only the
controller log mentions decryption, and pods sit in
`CreateContainerConfigError` waiting on a Secret that is never created.

The script generates fresh `POSTGRES_PASSWORD` and `JWT_SECRET` rather than
reusing the laptop's. Reusing a development database password on an
internet-facing cluster makes one compromise into two.

**It must be committed and pushed before step 6** — Argo CD syncs from git, not
from your working tree.

### 5. Argo CD

Argo CD is **not** exposed publicly. It is the deployment control plane — anyone
who reaches it can change what runs in the cluster — so it is reached by
port-forward rather than through the ALB:

```bash
kubectl port-forward svc/argocd-server -n argocd 8080:443
```

The wildcard certificate does cover `argocd.ahmadhadi.org`, so publishing it
later is an Ingress patch rather than a certificate reissue. The cheap half is
the Ingress; the expensive half is rotating the generated admin password and
putting SSO in front of it, which is what would make publishing it defensible.

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/v2.13.2/manifests/install.yaml
kubectl -n argocd rollout status deploy/argocd-server
kubectl apply -f k8s/argocd/03-controller-rbac.yaml
kubectl apply -f k8s/argocd/04-appproject.yaml
kubectl apply -f k8s/argocd/05-resource-inclusions.yaml
```

Apply the least-privilege RBAC from Phase 8 (`#73`) rather than leaving Argo on
the bundled `cluster-admin`.

### 6. Deploy

```bash
kubectl apply -f k8s/argocd/eks/
```

Three Applications: the app (`k8s/overlays/prod`), monitoring
(`k8s/overlays/prod-monitoring`), and the cluster components Argo now adopts.

Note these point at `k8s/overlays/prod`, **not** `k8s/overlays/dev` —
`k8s/argocd/01-application.yaml` targets dev and is what the k3d cluster
reconciles. The two clusters need two Applications.

### 7. DNS resolves itself

external-dns watches the Ingress objects and writes the Route 53 records. No
manual step. Confirm:

```bash
kubectl -n kube-system logs deploy/external-dns | tail
dig +short vesselmind.ahmadhadi.org
```

All three hostnames share **one** ALB via
`alb.ingress.kubernetes.io/group.name`. Without that group each Ingress would
provision its own load balancer — three at ~$16/month.

### 8. Publishing images to ECR (optional)

```bash
gh variable set AWS_ECR_ROLE_ARN --body "$(terraform -chdir=terraform output -raw github_actions_ecr_role_arn)"
./k8s/scripts/mirror-postgres-to-ecr.sh
```

The CI publish job is guarded on that variable because the ECR repositories are
destroyed with the cluster — an unconditional push would fail every merge to
main whenever the cluster is down. **Unset it after teardown.**

## Teardown

```bash
make -C terraform destroy
gh variable delete AWS_ECR_ROLE_ARN
kubectl config delete-context arn:aws:eks:us-east-1:<account>:cluster/vesselmind
```

`make destroy` deletes the Argo Applications, then the namespaces (which is what
actually removes the ALB and the EBS volumes, via their finalizers), and only
then runs `terraform destroy`. Doing it in the other order strands a billing ALB
and hangs the VPC delete on its ENIs.

Then confirm, rather than assume:

```bash
make -C terraform check-orphans
```

**One residual charge is expected.** The KMS key enters a 7-day pending-deletion
window and bills ~$1/month until it actually deletes — about $0.23. Seven days
is the AWS minimum; it cannot be shortened.

## Known limits

- **Postgres storage is AZ-pinned.** `WaitForFirstConsumer` creates the volume
  where the pod is scheduled, which fixes first start. It does not survive node
  loss: an EBS volume cannot change AZ, so the pod can only reschedule into the
  same zone. Real answers are RDS Multi-AZ or CloudNativePG.
- **One NAT gateway.** An AZ-a outage removes egress for AZ-b's nodes too.
- **The API endpoint is open to `0.0.0.0/0`** — authenticated, but reachable.
  `api_public_access_cidrs` narrows it in one line.
- **`AmazonEKS_CNI_Policy` is on the node role**, so every pod inherits ENI
  permissions. AWS recommends moving the CNI to IRSA.
- **Control-plane logging is off** by default; the audit stream is ~$0.50/GB.
- **NetworkPolicy enforcement is configured but unproven.** `enableNetworkPolicy`
  is set on the VPC CNI, which is necessary and not sufficient evidence.
