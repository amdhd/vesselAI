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
      # NAMESPACE IS external-dns, NOT kube-system. Unlike the EBS CSI driver
      # and the load balancer controller, this addon creates and deploys into
      # its OWN namespace. Getting this wrong produces a trust policy that
      # never matches: the ServiceAccount carries the role annotation, the pod
      # gets a projected token, and every AssumeRoleWithWebIdentity is denied
      # with an error that does not mention the namespace. Verified against the
      # running addon rather than assumed:
      #   kubectl get sa -A -o custom-columns=NS:.metadata.namespace,\
      #     NAME:.metadata.name,ROLE:.metadata.annotations.'eks\.amazonaws\.com/role-arn'
      values = ["system:serviceaccount:external-dns:external-dns"]
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
    # happened to match.
    #
    # NO --txt-owner-id IN extraArgs. The addon sets that flag itself, and
    # adding a second copy is fatal, not merely redundant:
    #
    #   level=fatal msg="flag parsing error: flag 'txt-owner-id' cannot be repeated"
    #
    # The pod CrashLoopBackOffs and the addon sits in CREATING until it times
    # out — so the failure surfaces as a stuck `terraform apply` rather than as
    # anything mentioning a duplicate flag. Anything the addon configures
    # through its own schema must not be repeated through extraArgs.
    registry = "txt"
  })

  depends_on = [aws_eks_node_group.main]
}
