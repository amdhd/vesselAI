# Private image registry.
#
# WHY ECR AT ALL, when GHCR already works: k8s/overlays/prod/kustomization.yaml
# verified that all five packages pull anonymously from GHCR, so no pull secret
# is needed and EKS could run today without this file. Two reasons it is here
# anyway. First, it is a stated Phase 9 deliverable and it exercises the path a
# real AWS shop uses — the node's IAM role grants the pull, so there is no
# registry credential in the cluster to rotate or leak. Second, it gives a
# place to mirror postgres:16-alpine, which today comes from Docker Hub, where
# anonymous pulls are rate-limited per source IP — and every node behind this
# VPC's single NAT gateway shares one IP. A node group scaling up during a load
# test is exactly when that limit bites.

resource "aws_ecr_repository" "app" {
  for_each = toset(var.ecr_repositories)

  name = "${var.cluster_name}/${each.value}"

  # *** IMMUTABLE, and this constrains CI ***
  #
  # Once a tag exists it can never be repointed. That is what makes "the running
  # pod names the exact commit that built it" true rather than aspirational, and
  # it is the same property the digest pinning in the prod overlay relies on.
  #
  # THE CONFLICT THIS CREATES: .github/workflows/ci.yml currently pushes TWO
  # tags per image — :<sha> and :main. Against an immutable repository the
  # second push of :main fails, so CI would break on the second merge to main,
  # not the first. The ECR push job must therefore publish the SHA tag ONLY.
  # The :main convenience pointer stays on GHCR, where mutability is harmless
  # because nothing deploys from it.
  #
  # The alternative was MUTABLE, which would let the existing CI publish
  # unchanged. Rejected: it discards the guarantee Phase 4 exists to establish,
  # to avoid editing one workflow file.
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    # Complements the Trivy gate in CI rather than duplicating it. Trivy blocks
    # the build; this re-scans what is already stored, which is how you find out
    # about a CVE published after the image shipped. A cluster runs images built
    # weeks ago — the scan that mattered at build time is stale by then.
    scan_on_push = true
  }

  encryption_configuration {
    # AES256, not a customer-managed KMS key. Switching encryption type forces
    # ECR to REPLACE the repository, destroying the image history — and the
    # history is the rollback path. Same reasoning as PipelineGuard's.
    encryption_type = "AES256"
  }

  # A three-day cluster's repositories have no reason to outlive it, and leaving
  # images behind is a slow leak: check-orphans deliberately does not look at
  # ECR, because repositories are supposed to outlive a cluster in normal use.
  force_delete = true
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 10 images; expire older ones."
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# Mirror of the one third-party image the cluster runs. Terraform creates the
# repository; pushing into it is a manual step, because Terraform does not move
# image bytes:
#
#   aws ecr get-login-password --region us-east-1 \
#     | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com
#   docker pull postgres:16-alpine
#   docker tag postgres:16-alpine <account>.dkr.ecr.us-east-1.amazonaws.com/vesselmind/postgres:16-alpine
#   docker push <account>.dkr.ecr.us-east-1.amazonaws.com/vesselmind/postgres:16-alpine
#
# MUTABLE here, unlike the app repositories: the upstream tag 16-alpine is
# itself a moving pointer, so an immutable mirror of it could only ever be
# written once and would then reject every subsequent upstream patch release.
# The prod overlay pins postgres by digest regardless, which is what actually
# fixes the version — the mirror solves rate limiting, not mutability.
resource "aws_ecr_repository" "postgres_mirror" {
  name                 = "${var.cluster_name}/postgres"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  force_delete = true
}
