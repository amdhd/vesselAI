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
