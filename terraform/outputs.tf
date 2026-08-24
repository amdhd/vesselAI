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
