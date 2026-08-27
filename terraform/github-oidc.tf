# GitHub Actions -> AWS, without long-lived credentials.
#
# ---------------------------------------------------------------------------
# THIS IS THE SAME MECHANISM AS IRSA, WITH A DIFFERENT ISSUER — worth being
# precise about, because they look alike and people conflate them.
#
#   IRSA:   issuer = the EKS cluster's OIDC endpoint
#           subject = system:serviceaccount:<ns>:<name>
#           the principal is a POD
#
#   This:   issuer = token.actions.githubusercontent.com
#           subject = repo:<owner>/<name>:ref:refs/heads/main
#           the principal is a WORKFLOW RUN
#
# Both end in sts:AssumeRoleWithWebIdentity against a federated identity
# provider, and both live or die on the `sub` condition. They are separate
# trust relationships and neither grants the other anything.
#
# THE ALTERNATIVE, and why it is rejected: an IAM user with an access key
# stored as a GitHub secret. That key is long-lived, has to be rotated by
# somebody who remembers to, and is exfiltratable by any workflow or action
# that can read secrets — which for a public repo is a meaningful surface. OIDC
# issues a credential that lasts minutes and cannot be replayed from anywhere
# else, because the token is bound to this repository and branch.
# ---------------------------------------------------------------------------

# LOOKED UP, NOT CREATED -- and this is not a style preference.
#
# IAM permits exactly ONE OIDC provider per issuer URL per ACCOUNT, and this
# account has two stacks that both want one: this one, and PipelineGuard
# (149751500899, ap-southeast-1), whose QA workflow assumes a role here.
# Whichever applied second failed with EntityAlreadyExists, and whichever
# destroyed first silently broke the other's role trust.
#
# It is now an account-level singleton created out-of-band by PipelineGuard's
# scripts/bootstrap.sh, alongside the Terraform state bucket -- the same
# reasoning, and it deliberately outlives every `terraform destroy`. That
# matters here in particular: this cluster is a burst resource that is torn down
# most of the time, so a provider owned by this stack would vanish with it.
#
# NOTE the contrast with aws_iam_openid_connect_provider.oidc in eks.tf. That
# one is the CLUSTER's IRSA issuer -- unique per cluster, created and destroyed
# with it, and correctly still a resource. Only the GitHub Actions issuer is
# account-wide.
#
# The thumbprint is no longer computed here; bootstrap.sh derives it from the
# live certificate chain for the same reason the comment below gives.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_ecr_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    # *** PINNED TO ONE REPO AND ONE BRANCH ***
    #
    # StringEquals on the full subject, not StringLike with a wildcard. The
    # classic and genuinely dangerous mistake here is `repo:owner/*` or a
    # trailing wildcard on the ref: the first lets ANY repository in the org
    # assume this role, the second lets any branch — including one opened by a
    # fork's pull request — push images to your production registry.
    #
    # Pinned to refs/heads/main because that is the only ref the publish job
    # runs on (see the `if:` guard in .github/workflows/ci.yml). A PR from a
    # fork therefore cannot obtain these credentials even if it changes the
    # workflow file.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/main"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "github_ecr" {
  # The login call is unavoidably unscoped — it returns a registry-wide
  # authorisation token and AWS does not support resource-level permissions on
  # it. Everything that token can then DO is bounded by the statement below.
  statement {
    sid       = "AuthToken"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # Push, scoped to this project's repositories only. Notably absent:
  # ecr:DeleteRepository, ecr:BatchDeleteImage and ecr:PutLifecyclePolicy. CI
  # publishes images; it has no business removing them, and immutable tags plus
  # a lifecycle policy are the retention mechanism — both owned by Terraform,
  # not by a workflow.
  statement {
    sid    = "PushToProjectRepos"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
      # Read-backs the docker client performs during a push.
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:DescribeImages",
      "ecr:DescribeRepositories",
    ]
    resources = concat(
      [for r in aws_ecr_repository.app : r.arn],
      [aws_ecr_repository.postgres_mirror.arn],
    )
  }
}

resource "aws_iam_policy" "github_ecr" {
  name        = "${var.cluster_name}-github-ecr-push"
  description = "Push-only, scoped to this project's ECR repositories. No delete."
  policy      = data.aws_iam_policy_document.github_ecr.json
}

resource "aws_iam_role" "github_ecr" {
  name               = "${var.cluster_name}-github-ecr-push"
  assume_role_policy = data.aws_iam_policy_document.github_ecr_assume_role.json
}

resource "aws_iam_role_policy_attachment" "github_ecr" {
  role       = aws_iam_role.github_ecr.name
  policy_arn = aws_iam_policy.github_ecr.arn
}
