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
