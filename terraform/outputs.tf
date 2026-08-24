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

output "ebs_csi_role_arn" {
  value       = aws_iam_role.ebs_csi.arn
  description = "IRSA role assumed by ebs-csi-controller-sa. Verify with: kubectl -n kube-system get sa ebs-csi-controller-sa -o yaml"
}

output "node_role_arn" {
  value       = aws_iam_role.node.arn
  description = "Node instance role. Carries ECR read access, which is why no imagePullSecret is needed."
}

output "lb_controller_role_arn" {
  value       = aws_iam_role.lb_controller.arn
  description = "IRSA role for the load balancer controller. Annotate its service account with this."
}

output "acm_certificate_arn" {
  value       = aws_acm_certificate_validation.main.certificate_arn
  description = "Validated certificate. Goes on the Ingress as alb.ingress.kubernetes.io/certificate-arn."
}

output "hostnames" {
  value       = local.hostnames
  description = "Hostnames the ingress will serve, all covered by the wildcard certificate."
}

output "cluster_autoscaler_role_arn" {
  value       = aws_iam_role.cluster_autoscaler.arn
  description = "IRSA role for cluster-autoscaler. Annotate the kube-system/cluster-autoscaler service account with it."
}

output "external_dns_role_arn" {
  value       = aws_iam_role.external_dns.arn
  description = "IRSA role for external-dns. Wired by the addon; nothing to annotate by hand."
}

output "github_actions_ecr_role_arn" {
  value       = aws_iam_role.github_ecr.arn
  description = "Set as the AWS_ECR_ROLE_ARN repo variable in GitHub so the publish job can assume it."
}

output "ecr_registry" {
  value       = split("/", aws_ecr_repository.app[var.ecr_repositories[0]].repository_url)[0]
  description = "<account>.dkr.ecr.<region>.amazonaws.com — the registry host CI logs in to."
}
