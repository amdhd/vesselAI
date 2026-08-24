# external-dns — IRSA consumer #4, and the piece that makes the hostnames
# actually resolve.
#
# THE GAP IT CLOSES: acm.tf creates a certificate for vesselmind./argocd./
# grafana.ahmadhadi.org but deliberately creates no A records, because the
# target is an ALB that does not exist until the load balancer controller
# reconciles an Ingress — after Terraform has finished, and never in Terraform
# state. The hosted zone therefore sits with nothing but NS and SOA in it, and
# every hostname fails to resolve.
#
# external-dns closes the loop from the other side: it watches Ingress objects,
# reads the host rules, finds the ALB the controller created, and writes the
# Route 53 records itself. DNS becomes declarative like everything else — the
# Ingress manifest is the single source of truth for both routing and naming.
#
# policy = "sync" (not the addon's "upsert-only" default) so records are also
# DELETED when the Ingress goes. That matters here specifically: `make destroy`
# removes the namespaces first, and with sync those records disappear with them
# instead of being left pointing at an ALB that no longer exists. Stale DNS is
# not billed, but it is the kind of debris that makes the next rebuild confusing.

data "aws_iam_policy_document" "external_dns" {
  # WRITES ARE SCOPED TO ONE ZONE. Not Resource "*". external-dns holds the
  # ability to rewrite DNS, which is as sharp as permissions get — a wildcard
  # here would let a compromised pod repoint any domain in the account,
  # including MX records, at anything it liked.
  statement {
    sid       = "ChangeRecordsInOwnZone"
    effect    = "Allow"
    actions   = ["route53:ChangeResourceRecordSets"]
    resources = ["arn:aws:route53:::hostedzone/${data.aws_route53_zone.main.zone_id}"]
  }

  # DISCOVERY — read-only, and unavoidably account-wide: external-dns has to
  # list zones before it can work out which one matches its domainFilter.
  # Read-only on DNS metadata is a materially different exposure from write.
  statement {
    sid    = "Discovery"
    effect = "Allow"
    actions = [
      "route53:ListHostedZones",
      "route53:ListResourceRecordSets",
      "route53:ListTagsForResource",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "external_dns" {
  name        = "${var.cluster_name}-external-dns"
  description = "Hand-written: record writes scoped to the ahmadhadi.org zone, discovery read-only."
  policy      = data.aws_iam_policy_document.external_dns.json
}

data "aws_iam_policy_document" "external_dns_assume_role" {
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
      values   = ["system:serviceaccount:kube-system:external-dns"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "external_dns" {
  name               = "${var.cluster_name}-external-dns"
  assume_role_policy = data.aws_iam_policy_document.external_dns_assume_role.json
}

resource "aws_iam_role_policy_attachment" "external_dns" {
  role       = aws_iam_role.external_dns.name
  policy_arn = aws_iam_policy.external_dns.arn
}

resource "aws_eks_addon" "external_dns" {
  cluster_name             = aws_eks_cluster.main.name
  addon_name               = "external-dns"
  service_account_role_arn = aws_iam_role.external_dns.arn

  configuration_values = jsonencode({
    # Ingress only. The addon's default also watches Services, which would make
    # every LoadBalancer Service capable of claiming a hostname — more surface
    # than this cluster needs, and harder to reason about than "the Ingress
    # says what it is called".
    sources = ["ingress"]

    # Refuse to touch anything outside this domain, whatever an Ingress claims.
    # A defence-in-depth pair with the IAM scoping above: IAM stops it writing
    # elsewhere, this stops it trying.
    domainFilters = [var.domain_name]

    # "sync" deletes records when the Ingress does; the default "upsert-only"
    # only ever adds. See the note at the top of this file for why teardown
    # makes that the right choice here.
    policy = "sync"

    # OWNERSHIP TRACKING. external-dns writes a companion TXT record beside each
    # A record recording that it owns it, and refuses to modify records without
    # one. Without this it cannot distinguish a record it created from one a
    # human added, and "sync" would happily delete hand-made records that
    # happened to match. The owner id must be unique per cluster — two clusters
    # sharing an id will fight over the same records.
    registry  = "txt"
    extraArgs = ["--txt-owner-id=${var.cluster_name}"]
  })

  depends_on = [aws_eks_node_group.main]
}
