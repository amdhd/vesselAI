output "vpc_id" {
  value       = aws_vpc.main.id
  description = "VPC the cluster runs in."
}

output "public_subnet_ids" {
  value       = aws_subnet.public[*].id
  description = "Where the ALB and NAT gateway live."
}

output "private_subnet_ids" {
  value       = aws_subnet.private[*].id
  description = "Where the nodes live."
}

output "ecr_repository_urls" {
  value       = { for k, v in aws_ecr_repository.app : k => v.repository_url }
  description = "Push targets for CI, and the newName values the prod overlay needs."
}

output "ecr_postgres_mirror_url" {
  value       = aws_ecr_repository.postgres_mirror.repository_url
  description = "Mirror target for postgres:16-alpine."
}

output "cluster_endpoint" {
  value       = aws_eks_cluster.main.endpoint
  description = "Kubernetes API server endpoint."
}

output "cluster_version" {
  value       = aws_eks_cluster.main.version
  description = "Running control plane version."
}

output "oidc_issuer_url" {
  value       = aws_eks_cluster.main.identity[0].oidc[0].issuer
  description = "The cluster's OIDC issuer. Step 1 of the IRSA chain."
}

output "oidc_provider_arn" {
  value       = aws_iam_openid_connect_provider.oidc.arn
  description = "IAM's registration of that issuer. Every IRSA trust policy names this as principal."
}

output "kubeconfig_command" {
  value       = "aws eks update-kubeconfig --name ${var.cluster_name} --region ${var.region}"
  description = "Run this after apply — the Makefile's destroy guard requires this context."
}
