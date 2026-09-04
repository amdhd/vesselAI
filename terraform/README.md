# terraform/

Builds the VesselMind EKS cluster from an empty AWS account: VPC, ECR, EKS 1.36,
a managed node group, four addons, five IRSA roles, KMS, ACM and the GitHub OIDC
trust CI pushes with. ~20 minutes to apply.

**The one thing to read before running anything: [`make destroy` is not
`terraform destroy`](#teardown).** Two of the most expensive objects in a running
cluster are not in Terraform state.

## Layout

Flat, single root module, one file per concern. There are no `modules/` and no
`environments/` because there is one environment and nothing is reused — a
module wrapper around resources with exactly one caller is indirection with no
payer.

| File | What lives in it |
|---|---|
| `versions.tf` | Provider pins, `default_tags`, and why state is local ([migration](#state)) |
| `variables.tf` | Every input, with the defaults an apply actually uses |
| `outputs.tf` | What CI and the k8s overlays consume |
| `vpc.tf` | VPC, IGW, 2 public + 2 private subnets, 1 NAT, subnet discovery tags |
| `eks.tf` | Control plane, KMS secrets encryption, the OIDC provider IRSA hangs off |
| `nodes.tf` | Managed node group, sized from measured demand |
| `addons.tf` | vpc-cni, ebs-csi (IRSA), metrics-server, cert-manager, external-dns |
| `lb-controller.tf` `external-dns.tf` `autoscaler.tf` | IRSA role + policy per controller |
| `kms.tf` | CMK for Secrets envelope encryption; EBS encrypted by default |
| `acm.tf` | Wildcard cert + Route 53 DNS validation |
| `ecr.tf` | 5 app repos (immutable) + 1 postgres mirror (mutable) |
| `github-oidc.tf` | CI assumes a role to push to ECR — no stored AWS keys |
| `policies/` | Vendored upstream IAM policy JSON, with its provenance documented |
| `Makefile` | The lifecycle. `make help` lists it. |

## Usage

```bash
make init
make plan
make apply          # then writes your kubeconfig entry
```

`CLUSTER_NAME`, `REGION` and `NAMESPACE` are overridable on any target:

```bash
make plan CLUSTER_NAME=vesselmind-2 REGION=eu-west-1
```

Credentials come from the `vesselmind-tf` profile, which wraps an SSO login in a
`credential_process` so the SDK re-fetches on demand. A plain
`aws configure export-credentials --format env` snapshot expires mid-apply; that
killed two applies during Phase 9. See the comment at the top of the `Makefile`.

## Teardown

```bash
make destroy
```

Not `terraform destroy`. The ALB is created by the AWS Load Balancer Controller
from a Kubernetes `Ingress`, and the Postgres EBS volumes are created by the EBS
CSI driver from PVCs — Terraform has never heard of either, so it leaves both
running and billing, then usually fails anyway when the ALB's ENIs block the VPC
delete.

`make destroy` runs the order that works: Argo Applications → namespaces (which
is what actually deletes the ALB and the volumes, via finalizers, against a
still-alive cluster) → `terraform destroy` → `make check-orphans`. The full
argument is in the `Makefile` header. If a namespace hangs, use
`make diagnose-stuck-namespace` before reaching for a finalizer force-patch.

Run `make check-orphans` after any teardown, including a failed one. Anything it
lists is still costing money.

## What CI checks

`.github/workflows/infra.yml` gates every change to this directory on
`terraform fmt -check`, `terraform validate`, `tflint`, and a Trivy
misconfiguration scan. It never runs `plan` or `apply` and holds no AWS
credentials — `init -backend=false` needs none.

`.terraform.lock.hcl` is committed and carries checksums for `linux_amd64`,
`linux_arm64`, `darwin_amd64` and `darwin_arm64`. It has to: a lock file
generated on one platform fails `terraform init` on CI's Linux runners with
*"provider does not have a package available"*. Regenerate with:

```bash
terraform providers lock -platform=linux_amd64 -platform=linux_arm64 -platform=darwin_arm64 -platform=darwin_amd64
```

## State

Local, deliberately. There is no `backend "s3"` block, so `terraform.tfstate`
sits next to these files. `versions.tf` argues why: neither risk a remote
backend mitigates — concurrent applies, and a laptop dying with the only copy of
state — exists for a three-day, single-operator cluster.

The cost, stated plainly: `terraform.tfstate` is the **only** record of what
exists in AWS. Lose it and `make destroy` cannot find the resources it is meant
to delete, which is the moment `make check-orphans` stops being paranoia and
becomes the only way to find what is still billing.

**The migration, when this stops being a burst cluster.** The bucket cannot be
created by this configuration — a backend cannot depend on resources the same
state file manages — so it is a one-time bootstrap:

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws s3api create-bucket --bucket vesselmind-tfstate-$ACCOUNT --region us-east-1
aws s3api put-bucket-versioning --bucket vesselmind-tfstate-$ACCOUNT \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket vesselmind-tfstate-$ACCOUNT \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]}'
```

Then add this to `versions.tf` and run `terraform init -migrate-state`:

```hcl
backend "s3" {
  bucket       = "vesselmind-tfstate-<account-id>"
  key          = "eks/terraform.tfstate"
  region       = "us-east-1"
  encrypt      = true
  use_lockfile = true
}
```

Versioning is the non-negotiable part — it is what lets you recover from a bad
apply that corrupts state, which is the failure remote state is actually bought
for. `use_lockfile` replaces the old DynamoDB lock table with native S3
conditional-write locking (Terraform 1.10+), so there is one less resource to
bootstrap and pay for.

## Known boundaries

These are choices, not oversights, and an interviewer should get the same answer
here as in the code:

- **Local state.** One operator, three-day cluster. Cost: `terraform.tfstate` is
  the only record of what exists. `backend.tf` has the migration.
- **One NAT gateway, not one per AZ.** Saves ~$32/month; an AZ-level SPOF for
  egress. Deliberate for a burst cluster, wrong for production.
- **The public API endpoint is restricted, not disabled.** `endpoint_public_access`
  is still `true`, so the endpoint exists — but `api_public_access_cidrs` has no
  default and a `validation` block rejects `0.0.0.0/0`, so every apply must name
  who gets in. `make plan`/`make apply` derive that from the operator's current
  public IP. Turning the public endpoint off entirely would be stronger, and is
  not done because `make destroy` runs `kubectl` from the operator's machine —
  a private-only endpoint breaks the teardown ordering, and a teardown that
  cannot run is a worse outcome than a firewalled endpoint.
- **Your IP changing locks you out** until the next `make apply`. That is the
  accepted cost of the line above.
- **Control-plane logging off** (`cluster_log_types = []`). The cheap default.
  Turning it on is a one-line change and a CloudWatch bill.
- **The Route 53 hosted zone is a data source**, not a resource. It predates this
  config and `terraform destroy` will not delete it — which is correct, but it
  means the zone's $0.50/month survives teardown.
