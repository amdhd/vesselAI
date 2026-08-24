# TLS certificate for the ingress.
#
# THIS IS WHAT MAKES PR #74's WORK REAL. That commit put TLS on every Ingress
# and turned off anonymous Grafana, on the argument that "it only answers on
# localhost" stops being true the moment this runs on EKS. Locally Traefik
# serves a self-signed certificate — encryption without trust, and a browser
# warning. Here the ALB terminates TLS with a certificate a browser accepts.
#
# ACM certificates used by an ALB are FREE. There is no cost line for this file;
# the only charge in the neighbourhood is $0.50/month for the hosted zone, which
# already exists.
#
# DNS VALIDATION, not email. Email validation needs a human to click a link in a
# mailbox at the domain, which cannot be automated and expires. DNS validation
# is a CNAME this file writes into the zone, and ACM renews the certificate
# automatically for as long as that record stays put — which is why the record
# must not be deleted after issuance.

data "aws_route53_zone" "main" {
  name         = "${var.domain_name}."
  private_zone = false
}

resource "aws_acm_certificate" "main" {
  domain_name = var.domain_name

  # One wildcard covers every hostname this cluster serves — vesselmind.,
  # argocd., grafana. — so adding a fourth service later needs no certificate
  # change. The alternative was naming each host explicitly, which is marginally
  # tighter (a wildcard certificate leaking would cover subdomains that do not
  # exist yet) but means a certificate re-issue and a fresh validation wait every
  # time a hostname is added.
  #
  # A wildcard does NOT cover the apex, which is why both are listed.
  subject_alternative_names = ["*.${var.domain_name}"]

  validation_method = "DNS"

  lifecycle {
    # A certificate cannot be destroyed while a listener references it. Creating
    # the replacement first means a rotation does not require an outage.
    create_before_destroy = true
  }

  tags = { Name = "${var.cluster_name}-cert" }
}

resource "aws_route53_record" "acm_validation" {
  # Both names validate through the same record here: ACM issues one challenge
  # per distinct domain, and the wildcard's challenge lands on the same
  # _<hash>.ahmadhadi.org name as the apex's. allow_overwrite below is what
  # keeps that collision from failing the apply — without it the second record
  # errors with "already exists", which looks like a leftover from a previous
  # run and is not.
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = data.aws_route53_zone.main.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "main" {
  # Blocks the apply until ACM has seen the DNS record and issued. Without this
  # gate Terraform would happily finish while the certificate is still PENDING,
  # and the ALB would later fail to attach a certificate that is not yet valid —
  # a failure that surfaces minutes later in the controller logs, far from its
  # cause.
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for r in aws_route53_record.acm_validation : r.fqdn]
}

locals {
  # The hostnames this cluster will serve. Kept here so the ingress annotations
  # and the DNS records that follow read from one place.
  #
  # NO A RECORDS ARE CREATED HERE. They must alias to the ALB, and the ALB does
  # not exist until the load balancer controller reconciles an Ingress — which
  # happens after this apply, and is not in Terraform state at all (the same
  # reason `make destroy` deletes namespaces before running terraform destroy).
  # Two ways to close that gap:
  #   - external-dns, which IS available as an EKS addon and would create these
  #     records from the Ingress objects automatically; or
  #   - one `aws route53 change-resource-record-sets` after the ALB appears.
  hostnames = {
    app     = "vesselmind.${var.domain_name}"
    grafana = "grafana.${var.domain_name}"
  }

  # NO PUBLIC HOSTNAME FOR ARGO CD, deliberately.
  #
  # Argo CD is the deployment control plane: anyone who gets into it can change
  # what runs in the cluster, and it holds the credentials to do so. Exposing
  # that admin UI on the public internet — protected only by a password that
  # ships as a generated default — is a materially worse trade than for Grafana,
  # which is read-only telemetry behind a sealed admin password.
  #
  # Reach it instead with:
  #   kubectl port-forward svc/argocd-server -n argocd 8080:443
  #
  # The wildcard certificate still covers argocd.${var.domain_name} should this
  # ever be revisited, so re-exposing it is an Ingress patch and not a
  # certificate reissue. That is the cheap half; the expensive half is rotating
  # the admin password and putting SSO in front of it, which is what would
  # actually make it safe to publish.
}
