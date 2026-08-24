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
