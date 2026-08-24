# AWS Load Balancer Controller — IRSA consumer #2, and the reason the Ingress
# objects in k8s/base become a real ALB.
#
# WHAT IT ACTUALLY DOES: watches Ingress objects with ingressClassName: alb and
# reconciles them into an Application Load Balancer, target groups, listeners
# and rules. The Ingress object itself remains what it always was — a rule with
# no process behind it. This controller is the process.
#
# WHY IT IS NOT A MANAGED ADDON: it is not offered as one. `aws eks
# describe-addon-versions` lists ebs-csi, vpc-cni, metrics-server, external-dns
# and others, but no load balancer controller — so unlike the EBS CSI driver,
# Terraform can only create the IAM side here. The controller itself installs
# from the upstream manifest, which keeps the project's no-Helm rule intact.
#
# THE TWO HALVES IT NEEDS, and why wiring one is worse than wiring neither:
#   - RBAC, to watch Ingress and Service objects. Ships in the upstream install.
#   - IRSA, to call the AWS ELB APIs. This file.
# With RBAC and no IRSA the controller runs, sees the Ingress, tries to create
# an ALB, and fails with AccessDenied in its own logs — while the Ingress object
# shows nothing at all. That asymmetry is the single most useful thing to know
# when debugging it:
#   kubectl -n kube-system logs deploy/aws-load-balancer-controller

resource "aws_iam_policy" "lb_controller" {
  name        = "${var.cluster_name}-lb-controller"
  description = "Upstream aws-load-balancer-controller policy, v3.5.0. See policies/README.md."

  # Vendored, not fetched at apply time. A policy pulled from a URL during apply
  # is one that can change without a commit — and this one grants 80 actions,
  # 10 of them on Resource "*". Pinning it means an upstream permission change
  # arrives as a reviewable diff.
  #
  # This is NOT least privilege and should not be claimed as such; it is the
  # configuration upstream supports. policies/README.md names the 13 actions
  # (shield, waf, wafv2, cognito-idp) that are dead weight for this project and
  # explains why they are still here.
  policy = file("${path.module}/policies/aws-load-balancer-controller.json")
}

data "aws_iam_policy_document" "lb_controller_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.oidc.arn]
    }

    # Same pinning as the EBS CSI role in addons.tf: this role is assumable ONLY
    # by the aws-load-balancer-controller service account in kube-system. The
    # service account name here must match the one in the upstream install
    # manifest exactly — a mismatch produces a controller that starts fine and
    # then cannot assume the role, which reads as a permissions bug rather than
    # a typo.
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = ["system:serviceaccount:kube-system:aws-load-balancer-controller"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lb_controller" {
  name               = "${var.cluster_name}-lb-controller"
  assume_role_policy = data.aws_iam_policy_document.lb_controller_assume_role.json
}

resource "aws_iam_role_policy_attachment" "lb_controller" {
  role       = aws_iam_role.lb_controller.name
  policy_arn = aws_iam_policy.lb_controller.arn
}
