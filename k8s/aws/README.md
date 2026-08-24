# EKS-only cluster components

Controllers that exist on EKS and have no equivalent on k3d. Kept out of
`k8s/base` for that reason: the base is shared with the laptop cluster, and
none of these would do anything there.

## Why the manifests are vendored rather than fetched

Each subdirectory contains the upstream install bundle, committed verbatim at a
pinned version, plus a small Kustomize overlay that patches the two or three
fields the upstream cannot know (cluster name, IRSA role ARN).

Vendoring costs ~2,000 lines of YAML that nobody wrote here. It buys three
things that matter more:

1. **Argo CD syncs from git.** A remote base means Argo fetches from the
   internet at sync time; the cluster's desired state then depends on GitHub
   being reachable, and on nobody having moved a tag.
2. **Upgrades arrive as a reviewable diff.** Bumping a version is a commit that
   shows exactly which RBAC rules and which webhook config changed. The same
   reasoning as `terraform/policies/README.md`.
3. **No Helm.** Both projects' primary install path is a Helm chart. The plain
   YAML bundles are the supported alternative, which is what keeps this
   project's no-Helm rule honest rather than aspirational.

## Contents

| Directory | Upstream | Version | Source |
|---|---|---|---|
| `load-balancer-controller/` | kubernetes-sigs/aws-load-balancer-controller | v3.5.0 | `v3_5_0_full.yaml`, `v3_5_0_ingclass.yaml` release assets |
| `cluster-autoscaler/` | kubernetes/autoscaler | 1.36.1 | `cloudprovider/aws/examples/cluster-autoscaler-autodiscover.yaml` |

`external-dns`, `cert-manager`, `metrics-server`, the EBS CSI driver and the
VPC CNI are **not** here — they are installed as managed EKS addons by
Terraform, which also wires their IRSA roles. Only components with no addon
available are vendored.

## Two upstream defaults that are wrong for this cluster

**The load balancer controller bundle requires cert-manager.** It ships an
`Issuer` and a `Certificate` for its admission webhook's serving certificate —
the Helm chart generates that itself, the plain YAML does not. `cert-manager`
is installed as an addon in `terraform/addons.tf`. This is the concrete cost of
the no-Helm rule, and worth being able to name.

**The cluster-autoscaler example pins an image that does not match this
cluster.** Upstream's example says `v1.32.1`; Cluster Autoscaler is versioned
in lockstep with Kubernetes and must match the control plane's minor version,
which here is 1.36. Running 1.32 against a 1.36 API server is a skew bug that
surfaces as unpredictable scheduling decisions rather than a clean failure. The
overlay pins `v1.36.1`.

## Updating

Re-download at the new tag, diff, read the diff, then bump the version in the
overlay's image or arg patches to match. A new upstream version granting new
RBAC is exactly what vendoring exists to make visible.
