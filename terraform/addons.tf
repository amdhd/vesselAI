# Cluster addons, and the first IRSA role in the project.

locals {
  # IAM condition keys are written against the issuer WITHOUT the scheme:
  #   oidc.eks.us-east-1.amazonaws.com/id/ABCD...:sub
  # Getting this wrong produces a trust policy that never matches, and the
  # resulting AccessDenied says nothing about why.
  oidc_host = replace(aws_iam_openid_connect_provider.oidc.url, "https://", "")
}

# ---------------------------------------------------------------------------
# EBS CSI driver — IRSA consumer #1
#
# Chosen as the first one on purpose: it is the simplest possible instance of
# the pattern, so the chain is legible before the load balancer controller
# arrives with a 200-line policy document.
#
# WHY THE CLUSTER NEEDS IT AT ALL: since 1.23 the in-tree EBS provisioner is
# gone. Without this driver a PersistentVolumeClaim stays Pending forever with
# no provisioner to answer it — so the Postgres StatefulSet never starts, and
# the event log says only "waiting for a volume to be created".
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ebs_csi_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type = "Federated"
      # The IAM registration of the cluster's OIDC issuer. This is what makes
      # a token minted by the cluster mean anything to STS.
      identifiers = [aws_iam_openid_connect_provider.oidc.arn]
    }

    # *** THE CONDITION THAT MAKES IRSA "PER-WORKLOAD" ***
    #
    # Without this the role is assumable by ANY service account in ANY namespace
    # of this cluster — the trust policy would say "anyone holding a token from
    # this issuer", and every pod holds one. The role still works, which is why
    # this omission survives code review so often.
    #
    # With it, only the ebs-csi-controller-sa service account in kube-system can
    # assume the role. Rename the service account and the assume-role starts
    # failing, which is the correct behaviour.
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = ["system:serviceaccount:kube-system:ebs-csi-controller-sa"]
    }

    # Pins the audience. A token minted for a different audience cannot be
    # replayed against this role.
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ebs_csi" {
  name               = "${var.cluster_name}-ebs-csi"
  assume_role_policy = data.aws_iam_policy_document.ebs_csi_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ebs_csi" {
  role       = aws_iam_role.ebs_csi.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}

resource "aws_eks_addon" "ebs_csi" {
  cluster_name = aws_eks_cluster.main.name
  addon_name   = "aws-ebs-csi-driver"

  # THE ANNOTATION STEP, done for us. Setting this makes EKS annotate the
  # driver's service account with eks.amazonaws.com/role-arn. Doing it by hand
  # would be:
  #   kubectl annotate sa ebs-csi-controller-sa -n kube-system \
  #     eks.amazonaws.com/role-arn=<arn>
  # Same mechanism either way — worth knowing, because for your own workloads
  # later there is no addon to do it for you.
  service_account_role_arn = aws_iam_role.ebs_csi.arn

  # The controller is a Deployment and needs somewhere to run.
  depends_on = [aws_eks_node_group.main]
}

# ---------------------------------------------------------------------------
# VPC CNI — declared explicitly ONLY to turn on NetworkPolicy enforcement.
#
# EKS installs this addon whether or not it is declared here. It is declared so
# that configuration_values can be set, and the setting below is the one that
# matters for Phase 7:
#
# THE VPC CNI IGNORES NetworkPolicy BY DEFAULT. Every NetworkPolicy in
# k8s/base/17-networkpolicies.yaml would be accepted by the API server, appear
# in `kubectl get netpol`, and enforce NOTHING. A default-deny that denies
# nothing looks identical to one that works — which is exactly the failure the
# Phase 7 notes warn about, and on EKS it is the default rather than a risk.
#
# Verify enforcement rather than trusting it: exec into a pod that policy says
# is blocked and try to reach Postgres. If it connects, this flag did not take.
# ---------------------------------------------------------------------------
resource "aws_eks_addon" "vpc_cni" {
  cluster_name = aws_eks_cluster.main.name
  addon_name   = "vpc-cni"

  configuration_values = jsonencode({
    enableNetworkPolicy = "true"

    env = {
      # *** PREFIX DELEGATION — required by the t3.medium node choice ***
      #
      # By default the CNI hands each pod one secondary IP from the node's ENIs,
      # so max-pods is a function of the INSTANCE TYPE, not its memory:
      #   ENIs x (IPs per ENI - 1) + 2
      #   t3.medium: 3 x (6-1) + 2 = 17 pods    <- the constraint here
      #   t3.large:  3 x (12-1) + 2 = 35 pods
      #
      # Three t3.medium therefore allows 51 pods. Counted at the HPA's peak this
      # cluster wants roughly 57 (27 app + 9 DaemonSet + 7 kube-system + 7
      # Prometheus + 7 Argo/sealed-secrets), so it would run out of ADDRESSES
      # before it ran out of CPU — and the symptom is pods stuck Pending with
      # CPU and memory plainly free, which sends you debugging the wrong thing.
      #
      # Prefix delegation assigns each ENI a /28 prefix (16 addresses) instead
      # of single IPs, raising t3.medium to 110 pods. Diagnose the failure it
      # prevents with:
      #   kubectl describe node | grep -A2 Allocatable
      #   kubectl get events --field-selector reason=FailedScheduling
      #
      # THE COST: prefixes are carved from the subnet, so address space is
      # consumed in blocks of 16 whether or not the pods exist. Three nodes x 3
      # ENIs x 16 = 144 addresses against a /24's 251 usable. It fits, but a /24
      # per subnet is now a real ceiling rather than a generous one.
      ENABLE_PREFIX_DELEGATION = "true"

      # Keep one spare prefix warm per node. Without it the first pods on a new
      # node wait on an EC2 API call to allocate a prefix, which shows up as
      # slow pod startup during exactly the scale-up event Phase 5 measures.
      WARM_PREFIX_TARGET = "1"
    }
  })

  # The addon already exists (EKS created it at cluster creation), so adopting
  # it requires saying explicitly that our configuration wins.
  resolve_conflicts_on_create = "OVERWRITE"
  resolve_conflicts_on_update = "OVERWRITE"
}
