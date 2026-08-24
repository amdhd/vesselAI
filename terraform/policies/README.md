# Vendored IAM policies

## aws-load-balancer-controller.json

Verbatim copy of the upstream policy from
`kubernetes-sigs/aws-load-balancer-controller`, tag **v3.5.0**:

    https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v3.5.0/docs/install/iam_policy.json

Vendored rather than fetched at apply time so that the permissions granted are
pinned, reviewable in a diff, and identical on every apply. A policy fetched
from a URL at apply time is a policy that can change without a commit.

**16 statements, 80 actions, 10 of them on `Resource: "*"`.** This is not least
privilege and should not be described as such — it is the configuration upstream
supports, which is a different claim.

Statements that are dead weight for THIS project, because nothing here uses the
annotations that trigger them:

| Service        | Actions | Used when |
|----------------|---------|-----------|
| `shield:*`     | 4       | AWS Shield Advanced protection on the ALB |
| `waf-regional` | 4       | WAF Classic association |
| `wafv2:*`      | 4       | WAFv2 association |
| `cognito-idp`  | 1       | ALB authenticate-oidc via Cognito |

Dropping those 13 actions is a defensible tightening, and being able to say
which permissions were removed and why is worth more than the removal itself.
It is not done by default because the controller's behaviour when a preflight
call is denied is version-specific, and a subtle reconcile failure is an
expensive thing to debug inside a three-day burst. Tighten it deliberately,
with the controller logs open — not as a drive-by.

To update: change the tag in the URL above, re-download, and diff. Read the
diff; a new upstream version granting new permissions is exactly the thing this
file exists to make visible.
