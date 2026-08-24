variable "region" {
  description = "AWS region. us-east-1 is cheapest and is what the cost estimates assume."
  type        = string
  default     = "us-east-1"
}

variable "cluster_name" {
  description = "EKS cluster name. Must match CLUSTER_NAME in the Makefile — the destroy guard compares the kubectl context against it."
  type        = string
  default     = "vesselmind"
}

variable "vpc_cidr" {
  description = "VPC address range. A /16 is far more than this needs; it costs nothing and avoids re-planning subnets later."
  type        = string
  default     = "10.0.0.0/16"
}

# Two is the minimum EKS accepts, and also the minimum that makes topology
# spread and anti-affinity mean anything. Three would be more production-like
# and subnets themselves are free — but with a single NAT gateway the third AZ's
# egress still crosses into AZ-a, so it buys less resilience than it appears to.
variable "az_count" {
  description = "Number of availability zones to spread subnets across."
  type        = number
  default     = 2
}

# The five images CI builds today — see .github/workflows/ci.yml.
variable "ecr_repositories" {
  description = "Image names to create ECR repositories for."
  type        = list(string)
  default = [
    "vesselai-api",
    "vesselai-web",
    "vesselai-analytics",
    "vesselai-migrate",
    "vesselai-warehouse-builder",
  ]
}

variable "cluster_version" {
  description = "EKS control plane version. 1.36 is the current default and is in standard support until 2027-08."
  type        = string
  default     = "1.36"
}

# Control plane logs go to CloudWatch and are billed on INGEST at ~$0.50/GB.
# The audit stream on a busy cluster is 1-2 GB/day, so leaving this on for a
# three-day burst is a few dollars — small, but it is the line item nobody
# predicts, which is exactly why it is a variable and not a hardcoded default.
#
# What each stream is actually good for:
#   authenticator - who mapped to what identity. The first place to look when
#                   kubectl says Forbidden and you think IRSA is broken.
#   audit         - every API request. What proves an RBAC Role or a
#                   NetworkPolicy denial happened rather than being assumed.
#   api           - control plane chatter. Rarely what you want.
#
# Turn `audit` on for the Phase 7 RBAC and NetworkPolicy demonstrations, then
# turn it back off.
variable "cluster_log_types" {
  description = "EKS control plane log streams to ship to CloudWatch. Empty = none, which is the cheap default."
  type        = list(string)
  default     = []
}

# WHO MAY REACH THE KUBERNETES API SERVER.
#
# 0.0.0.0/0 means the API endpoint is on the public internet. It is not
# unauthenticated — every request still needs a valid IAM identity — but it is
# reachable, and "reachable and authenticated" is a weaker position than "not
# reachable". Narrowing this to a home IP is a one-line change and is what a
# real deployment does.
#
# Left open by default on purpose: a laptop's IP changes when the network does,
# and locking yourself out of your own cluster mid-phase costs more time than
# the exposure costs risk for a cluster that lives three days. State the
# tradeoff rather than pretending the default is the secure choice.
variable "api_public_access_cidrs" {
  description = "CIDRs allowed to reach the Kubernetes API server endpoint."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# t3.medium x3, x86, ON_DEMAND — each part is a decision:
#
#   t3.medium  NOT t3.large, and the reasoning is worth keeping because the
#              obvious choice is wrong. Both are 2 vCPU; t3.large's only
#              advantage is 8GiB of RAM against t3.medium's 4GiB.
#
#              Measured demand, from k8s/scripts/check-quota-headroom.py run
#              against the prod overlay, is 5.30 CPU / 5.62Gi at the HPA's
#              20-replica peak. So:
#
#                2x t3.large  = 4 vCPU raw, ~3.86 allocatable -> DOES NOT FIT.
#                               ~14.4Gi allocatable against a 5.6Gi peak, i.e.
#                               61% of the memory is never touched.
#                3x t3.medium = 6 vCPU raw, ~5.8 allocatable  -> fits.
#                               ~10.1Gi allocatable, enough for the workloads
#                               plus Prometheus (~2Gi) and Argo CD (~600Mi).
#
#              Three mediums are also $28/month CHEAPER than two larges, and
#              give a THIRD NODE — which is what makes `kubectl drain` and the
#              PodDisruptionBudget work in Phases 2 and 7 demonstrable rather
#              than theoretical. Strictly better on every axis except spare RAM,
#              which was the one resource already in surplus.
#
#   x86        NOT Graviton. t4g.medium is ~20% cheaper, but CI passes no
#              `platforms:` to docker/build-push-action, so every image in GHCR
#              and ECR is linux/amd64 only. Graviton needs multi-arch buildx —
#              a real change, not a flag.
#
#   ON_DEMAND  Spot is ~68% cheaper ($0.0268/hr vs $0.0416) and the
#              interruptions would be a genuinely good PodDisruptionBudget demo.
#              Not for the first bring-up though: a spot reclaim mid-debug
#              produces failures that look exactly like your own bug. Flip
#              node_capacity_type to SPOT once the cluster is green.
#
# CAVEAT THAT MATTERS FOR PHASE 5's NUMBERS: t3 is BURSTABLE. Baseline is 20%
# of 2 vCPU for a medium; under a sustained k6 load the CPU credit balance
# drains and the instance throttles to that baseline. Any p95 latency or
# scale-up time measured in that state is a measurement of credit exhaustion,
# not of the application. Run the load test on c5.large (non-burstable, 2 vCPU
# sustained, ~$0.085/hr) or enable T3 Unlimited, and record which was used.
variable "node_instance_types" {
  description = "Instance types for the managed node group."
  type        = list(string)
  default     = ["t3.medium"]
}

variable "node_capacity_type" {
  description = "ON_DEMAND or SPOT. Start ON_DEMAND; move to SPOT once the cluster works."
  type        = string
  default     = "ON_DEMAND"
}

variable "node_desired_size" {
  description = "Nodes at rest. Three, so the measured 5.30 CPU peak fits and a drain has two nodes to spill onto."
  type        = number
  default     = 3
}

variable "node_min_size" {
  description = "Floor. Three — dropping to two puts the peak back out of reach."
  type        = number
  default     = 3
}

# Headroom above the measured peak, and a ceiling on what a runaway HPA can
# cost. Five t3.medium is ~9.7 CPU allocatable against a 5.30 peak, and bounds
# the node bill at ~$0.21/hr.
variable "node_max_size" {
  description = "Ceiling. Bounds the blast radius of a runaway HPA on the bill."
  type        = number
  default     = 5
}

variable "node_disk_size" {
  description = "Root EBS volume per node, GiB. Images and ephemeral storage only — Postgres uses its own PVC."
  type        = number
  default     = 20
}

variable "domain_name" {
  description = "Public domain for the ingress. Hosted zone must already exist in Route 53."
  type        = string
  default     = "ahmadhadi.org"
}

variable "github_repository" {
  description = "owner/name of the GitHub repo allowed to push to ECR. The IAM trust policy pins to this exact repo."
  type        = string
  default     = "amdhd/vesselAI"
}
