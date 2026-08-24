# Cluster Autoscaler — IRSA consumer #3, and the thing that makes
# node_max_size mean anything.
#
# THE GAP THIS CLOSES: the HPA scales PODS. Nothing scaled NODES. With three
# t3.medium and an HPA allowed to reach 20 API replicas, the peak demand of
# 5.30 CPU exceeds the ~5.79 the cluster has, so the last replicas would sit
# Pending forever — and `node_max_size = 5` was a number no process could ever
# act on. That is not a subtle problem for this project specifically: Phase 5's
# whole deliverable is a measured scale-up, and measuring one that silently
# stops at the node ceiling produces a number that is wrong.
#
# CLUSTER AUTOSCALER, NOT KARPENTER. Karpenter is the better tool and what a
# new AWS cluster would generally pick today: it provisions right-sized nodes
# directly from pending pods instead of resizing a fixed ASG, and it is faster.
# It also replaces the managed node group as the unit of compute, which would
# discard the node group this phase already built and verified — and the point
# of the node group was to have real nodes to drain and cordon. Cluster
# Autoscaler works WITH the existing ASG, so it is additive.
# Worth being able to say out loud: Karpenter is the more modern answer, and
# the reason for not using it here is scope, not merit.
#
# THIS FILE IS THE IAM HALF ONLY. Same split as the load balancer controller:
# Terraform grants the AWS permissions, the controller itself installs from the
# upstream manifest. A cluster autoscaler with RBAC and no IRSA runs, sees
# Pending pods, tries to raise the ASG's desired capacity, and fails with
# AccessDenied in its own logs while the pods stay Pending — which reads as
# "the autoscaler is broken" rather than "the autoscaler cannot reach AWS".

data "aws_iam_policy_document" "cluster_autoscaler" {
  # DISCOVERY — read-only, and unavoidably broad. The autoscaler has to be able
  # to see every ASG before it can work out which ones carry the discovery tags
  # below, so these cannot be scoped to a specific group.
  statement {
    sid    = "Discovery"
    effect = "Allow"
    actions = [
      "autoscaling:DescribeAutoScalingGroups",
      "autoscaling:DescribeAutoScalingInstances",
      "autoscaling:DescribeLaunchConfigurations",
      "autoscaling:DescribeScalingActivities",
      "autoscaling:DescribeTags",
      "ec2:DescribeImages",
      "ec2:DescribeInstanceTypes",
      "ec2:DescribeLaunchTemplateVersions",
      "ec2:GetInstanceTypesFromInstanceRequirements",
      "eks:DescribeNodegroup",
    ]
    resources = ["*"]
  }

  # MUTATION — scoped by condition to ASGs this cluster owns.
  #
  # Unlike the vendored load balancer controller policy, this one is written by
  # hand and the write actions are NOT on Resource "*". The condition means that
  # even though discovery can see every ASG in the account, the autoscaler can
  # only resize or terminate instances in groups tagged as belonging to this
  # cluster. Without it, a bug or a compromised autoscaler could terminate
  # instances in an unrelated ASG.
  statement {
    sid    = "ScaleOwnedGroups"
    effect = "Allow"
    actions = [
      "autoscaling:SetDesiredCapacity",
      "autoscaling:TerminateInstanceInAutoScalingGroup",
    ]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/k8s.io/cluster-autoscaler/${var.cluster_name}"
      values   = ["owned"]
    }
  }
}

resource "aws_iam_policy" "cluster_autoscaler" {
  name        = "${var.cluster_name}-cluster-autoscaler"
  description = "Hand-written least-privilege policy: broad discovery, tag-scoped mutation."
  policy      = data.aws_iam_policy_document.cluster_autoscaler.json
}

data "aws_iam_policy_document" "cluster_autoscaler_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.oidc.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = ["system:serviceaccount:kube-system:cluster-autoscaler"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cluster_autoscaler" {
  name               = "${var.cluster_name}-cluster-autoscaler"
  assume_role_policy = data.aws_iam_policy_document.cluster_autoscaler_assume_role.json
}

resource "aws_iam_role_policy_attachment" "cluster_autoscaler" {
  role       = aws_iam_role.cluster_autoscaler.name
  policy_arn = aws_iam_policy.cluster_autoscaler.arn
}

# --- ASG discovery tags ----------------------------------------------------
#
# The autoscaler finds groups to manage by TAG, not by configuration. Managed
# node groups do NOT propagate their own tags to the underlying ASG, so these
# have to be set on the ASG directly — and without them the autoscaler starts
# cleanly, discovers nothing, and does nothing, with no error anywhere. That is
# the same silent-no-op shape as the missing subnet tags in vpc.tf.
#
# The second tag is also what the IAM condition above keys on, so these tags are
# doing double duty: discovery for the autoscaler, and authorisation scope for
# IAM. Removing them does not just stop autoscaling, it also revokes the
# permission — which is the correct direction to fail in.
# A managed node group creates exactly ONE Auto Scaling group, so these index
# it directly rather than iterating.
#
# The first draft used for_each over the set of ASG names, which fails at PLAN
# time with "Invalid for_each argument": the names do not exist until the node
# group is created, and for_each keys must be known before apply. Caught by
# running a plan; it would otherwise have failed partway through an apply, with
# the cluster and node group already built and billing.
locals {
  node_asg_name = aws_eks_node_group.main.resources[0].autoscaling_groups[0].name
}

resource "aws_autoscaling_group_tag" "autoscaler_enabled" {
  autoscaling_group_name = local.node_asg_name

  tag {
    key   = "k8s.io/cluster-autoscaler/enabled"
    value = "true"
    # false: this tags the GROUP for discovery. Propagating it to each instance
    # would put a meaningless tag on every node without changing behaviour.
    propagate_at_launch = false
  }
}

resource "aws_autoscaling_group_tag" "autoscaler_owned" {
  autoscaling_group_name = local.node_asg_name

  tag {
    key                 = "k8s.io/cluster-autoscaler/${var.cluster_name}"
    value               = "owned"
    propagate_at_launch = false
  }
}
