# The EKS control plane, and the OIDC provider that makes IRSA possible.
#
# ---------------------------------------------------------------------------
# IRSA, END TO END — the thing this phase exists to demonstrate
# ---------------------------------------------------------------------------
#
# The problem it solves: a pod needs to call an AWS API. Without IRSA the only
# credential available is the NODE's instance profile, which means EVERY pod on
# that node shares one identity. Grant the EBS CSI driver permission to delete
# volumes and you have also granted it to the API pod, the web pod, and anything
# that manages to run a shell there. There is no per-workload scoping at all.
#
# The chain IRSA replaces it with, in order:
#
#   1. The cluster publishes an OIDC ISSUER — an HTTPS endpoint serving signed
#      JWTs and the public keys to verify them. EKS creates this for you; it is
#      aws_eks_cluster.main.identity[0].oidc[0].issuer below.
#
#   2. aws_iam_openid_connect_provider registers that issuer in IAM as a trusted
#      identity provider. THIS IS THE STEP PEOPLE FORGET. Without it the issuer
#      exists and IAM has never heard of it, so every AssumeRoleWithWebIdentity
#      is rejected with an error that does not mention the missing provider.
#
#   3. An IAM role's TRUST POLICY names that provider as principal and pins two
#      conditions: audience must be sts.amazonaws.com, and `sub` must equal
#      system:serviceaccount:<namespace>:<name>. The sub condition is what makes
#      the role usable by ONE service account instead of anything in the cluster.
#      Omitting it is the classic IRSA mistake — the role still works, and it is
#      now assumable by every pod in every namespace.
#
#   4. A ServiceAccount is annotated eks.amazonaws.com/role-arn: <role>.
#
#   5. A pod using that ServiceAccount gets a projected, short-lived token
#      mounted at /var/run/secrets/eks.amazonaws.com/serviceaccount/token, plus
#      AWS_ROLE_ARN and AWS_WEB_IDENTITY_TOKEN_FILE injected by a webhook. Any
#      AWS SDK picks those up automatically and calls
#      sts:AssumeRoleWithWebIdentity. Nothing in the application changes.
#
# IRSA IS IAM, NOT KUBERNETES RBAC. They are separate systems that answer
# different questions, and conflating them is the most common confusion here:
#
#   RBAC answers "may this identity call the KUBERNETES API?" — get pods, patch
#   deployments. Enforced by the API server. Phase 7's Role and RoleBinding.
#
#   IRSA answers "may this pod call the AWS API?" — create a load balancer,
#   delete an EBS volume. Enforced by AWS STS and IAM. Nothing to do with RBAC.
#
# A pod can have cluster-admin RBAC and no AWS access whatsoever, or full
# AdministratorAccess in IAM and no permission to list pods. The AWS Load
# Balancer Controller needs BOTH: RBAC to watch Ingress objects, IRSA to create
# the ALB. Wiring one and not the other produces a controller that runs happily
# and silently accomplishes nothing.
# ---------------------------------------------------------------------------

# --- Control plane IAM role ------------------------------------------------

data "aws_iam_policy_document" "cluster_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cluster" {
  name               = "${var.cluster_name}-cluster"
  assume_role_policy = data.aws_iam_policy_document.cluster_assume_role.json
}

resource "aws_iam_role_policy_attachment" "cluster" {
  # AWS-managed, deliberately. This is a SERVICE role: the permission set is
  # AWS's contract with itself for operating a control plane, and hand-writing
  # it produces a cluster that half-works in ways that are painful to diagnose.
  # Contrast Phase 7's Role, which is hand-written precisely because it governs
  # our own workloads and least privilege is the point there.
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

# --- The cluster -----------------------------------------------------------

# One accepted scanner finding, declared here rather than filtered out in the
# workflow, so the exception is read by anyone reading the resource it excuses.
#
# AVD-AWS-0040 flags that the public endpoint exists at all. It does, and it is
# reachable ONLY from the CIDRs in api_public_access_cidrs — which has no default
# and rejects 0.0.0.0/0 (variables.tf), so it is whoever ran the apply and nobody
# else. The private endpoint is on as well, so nodes and in-cluster controllers
# never leave the VPC to reach the API server.
#
# WHY NOT endpoint_public_access = false, which would clear this finding
# outright: `make destroy` runs kubectl from the operator's machine, and it has
# to, because deleting the namespaces is what makes the controllers delete the
# ALB and the Postgres EBS volumes. A private-only endpoint means that step can
# only run from inside the VPC, so a teardown needs a bastion the teardown
# itself would then have to delete. A cluster that cannot be torn down is a
# worse outcome — and a more expensive one — than a firewalled endpoint.
#
# A companion once sat here for AVD-AWS-0041 (open CIDR). It is gone because
# the finding is gone: with no 0.0.0.0/0 default left in variables.tf there is
# nothing for that check to fire on, and an ignore for a rule that no longer
# triggers is dead config that reads like a live exception.
#
# The expiry stays. An ignore with no expiry is a permanent decision made once;
# this one is "acceptable while a human tears the cluster down by hand", and
# should be re-argued rather than inherited.
#trivy:ignore:AVD-AWS-0040 exp:2027-01-01
resource "aws_eks_cluster" "main" {
  name     = var.cluster_name
  version  = var.cluster_version
  role_arn = aws_iam_role.cluster.arn

  vpc_config {
    # Both subnet tiers. The control plane places cross-account ENIs here to
    # reach the kubelet on each node; giving it only public subnets works but
    # means that traffic leaves the private tier for no reason.
    subnet_ids = concat(aws_subnet.private[*].id, aws_subnet.public[*].id)

    # Public endpoint so kubectl works from the laptop; private endpoint so
    # node-to-API traffic never leaves the VPC. With both enabled, in-cluster
    # traffic resolves to the private address and only your kubectl goes over
    # the internet.
    endpoint_public_access  = true
    endpoint_private_access = true
    public_access_cidrs     = var.api_public_access_cidrs
  }

  access_config {
    # API, not the legacy aws-auth ConfigMap.
    #
    # aws-auth is one of the great Kubernetes footguns: a single ConfigMap, no
    # validation, and it is the ONLY thing mapping IAM identities to cluster
    # permissions. A bad edit locks every human out of a running cluster with no
    # path back short of AWS support. Access entries are IAM-side objects —
    # reversible, auditable, and incapable of bricking the cluster.
    authentication_mode = "API"

    # Grants cluster-admin to whoever runs `terraform apply` — here, the
    # vessel-k8 IAM user. Without it the cluster comes up and the person who
    # just created it cannot run `kubectl get nodes`, which is a genuinely
    # baffling first five minutes.
    bootstrap_cluster_creator_admin_permissions = true
  }

  # ENVELOPE ENCRYPTION FOR KUBERNETES SECRETS.
  #
  # EKS already encrypts etcd at rest with an AWS-owned key. This adds a second
  # layer under a key in THIS account: the API server encrypts each Secret with
  # a data key that KMS wraps, so reading etcd is not enough — an attacker also
  # needs kms:Decrypt on aws_kms_key.eks, which is auditable in CloudTrail.
  #
  # *** THIS IS A ONE-WAY DOOR. *** Encryption can be ENABLED on an existing
  # cluster but never disabled, and the key must never be deleted or every
  # Secret in the cluster becomes unreadable. That is why the key has rotation
  # on and a deletion window rather than being disposable.
  #
  # Scope is "secrets" because that is the only resource type EKS supports here.
  encryption_config {
    provider {
      key_arn = aws_kms_key.eks.arn
    }
    resources = ["secrets"]
  }

  enabled_cluster_log_types = var.cluster_log_types

  # The role must carry its policy BEFORE the cluster is created. Terraform
  # infers a dependency on the role from role_arn above, but not on the
  # attachment — without this the create races and intermittently fails with a
  # permissions error that disappears on retry, which is the worst kind of bug.
  depends_on = [aws_iam_role_policy_attachment.cluster]

  tags = { Name = var.cluster_name }
}

# --- OIDC provider: the IRSA foundation ------------------------------------

data "tls_certificate" "oidc" {
  # Reads the certificate the OIDC issuer serves, so the thumbprint below is
  # derived rather than copied from a blog post.
  url = aws_eks_cluster.main.identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "oidc" {
  url             = aws_eks_cluster.main.identity[0].oidc[0].issuer
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.oidc.certificates[0].sha1_fingerprint]

  tags = { Name = "${var.cluster_name}-irsa" }
}
