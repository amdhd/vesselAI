# VesselMind — AWS Architecture

Source of truth: `terraform/*.tf` (18 files) and `k8s/` (base + overlays + argocd).
Diagram: `aws-architecture.drawio` (editable) / `aws-architecture.png` (embedded XML, re-editable).

## Request flow

1. **Users → Route 53** — hosted zone `ahmadhadi.org` (data source, zone pre-exists). A/AAAA records for `vesselmind.*` and `grafana.*` are created in-cluster by the `external-dns` EKS addon, not by Terraform.
2. **Route 53 → Internet Gateway → ALB** — the ALB lives in the two public subnets. Terraform does *not* create it: the AWS Load Balancer Controller provisions it from the Kubernetes `Ingress` (`k8s/base/10-ingress.yaml`). Terraform only creates the controller's IAM policy + IRSA role.
3. **ACM → ALB** — wildcard cert (`ahmadhadi.org` + `*.ahmadhadi.org`), DNS-validated via `aws_route53_record.acm_validation`.
4. **ALB → node group (private subnets)** — target pods: `web` (nginx), `api` (with HPA), `analytics`, `worker`, plus `postgres` StatefulSet and the `warehouse-refresh` CronJob.
5. **Nodes → EBS** — gp3 PVs for postgres data, backups, and the DuckDB warehouse, via the `aws-ebs-csi-driver` addon (IRSA role `ebs-csi-controller-sa`).
6. **Nodes → NAT Gateway → internet/ECR** — one NAT with one EIP; private subnets have no inbound internet route.

## CI/CD path

GitHub Actions (`amdhd/vesselAI`) assumes an IAM role via the pre-existing GitHub OIDC provider (`sts:AssumeRoleWithWebIdentity`), scoped to ECR push only, and pushes images. Nodes pull them out through the NAT gateway. Argo CD (in-cluster, `k8s/argocd/`) reconciles the manifests.

## Resource inventory (from Terraform)

| Area | Resources |
|---|---|
| Network (`vpc.tf`) | VPC `10.0.0.0/16`, IGW, 2 public `/24` + 2 private `/24` across 2 AZs, 1 NAT + EIP, route tables, locked-down default SG |
| Cluster (`eks.tf`) | `aws_eks_cluster` v1.36, public+private endpoint, `authentication_mode = API`, KMS secrets encryption, IAM OIDC provider for IRSA. Control-plane logs off by default (`cluster_log_types = []`) |
| Nodes (`nodes.tf`) | Managed node group, 3–5 × `t3.medium` ON_DEMAND, AL2023, 20 GB, private subnets only |
| Addons (`addons.tf`) | `vpc-cni`, `aws-ebs-csi-driver`, `metrics-server`, `cert-manager`, `external-dns` |
| IRSA (`lb-controller.tf`, `external-dns.tf`, `autoscaler.tf`, `addons.tf`) | Roles + policies for aws-load-balancer-controller, external-dns, cluster-autoscaler, ebs-csi-controller-sa |
| Registry (`ecr.tf`) | 5 app repos (api, web, analytics, migrate, warehouse-builder) with IMMUTABLE tags + scan-on-push + keep-last-10 lifecycle, plus a MUTABLE `postgres` mirror repo |
| Crypto (`kms.tf`) | CMK + alias for EKS secrets; `aws_ebs_encryption_by_default` on |
| TLS/DNS (`acm.tf`) | Wildcard ACM cert + Route 53 validation records + validation resource |
| CI identity (`github-oidc.tf`) | GitHub OIDC assume-role + ECR push policy |

## Deliberate design choices (from the Terraform comments and defaults)

- **Nodes in private subnets behind a NAT**, not public subnets with public IPs — costs ~$0.05/hr more but is the shape real clusters have, and the IRSA/SG work only makes sense against it.
- **Single NAT gateway**, not one per AZ — a cost choice; it is an AZ-level SPOF for egress.
- **`api_public_access_cidrs = ["0.0.0.0/0"]`** — the API server endpoint is publicly reachable (auth still required). Tighten for a real production account.
- **Control-plane logging disabled by default** — the cheap default; enable `cluster_log_types` if you want CloudWatch audit trails.
- **ECR immutable tags** for app images, mutable only for the postgres mirror.

## Not in this diagram (in-cluster, not AWS resources)

Sealed Secrets controller, Argo CD, Prometheus + Grafana, NetworkPolicies, ResourceQuota, PDBs, the k6 load-test job, and the postgres backup CronJob. They run on the node group shown; see `k8s/` for their manifests.
