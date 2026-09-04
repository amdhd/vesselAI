# State backend.
#
# INTENTIONALLY EMPTY. There is no `backend "s3"` block, so Terraform uses the
# local backend and writes terraform.tfstate next to these files. versions.tf
# argues why that is defensible for a three-day, single-operator burst cluster:
# neither risk a remote backend mitigates — concurrent applies, and a laptop
# dying with the only copy of state — exists here.
#
# What it costs, stated plainly rather than left for a reviewer to find:
# terraform.tfstate is the ONLY record of what exists in AWS. Lose it and
# `make destroy` cannot find the resources it is meant to delete, which is the
# moment `make check-orphans` stops being paranoia and becomes the only way to
# find what is still billing.
#
# THE MIGRATION, when this stops being a burst cluster. The bucket and table
# cannot be created by this configuration — a backend cannot depend on
# resources the same state file manages — so they are a one-time bootstrap:
#
#   aws s3api create-bucket --bucket vesselmind-tfstate-$(aws sts get-caller-identity --query Account --output text) --region us-east-1
#   aws s3api put-bucket-versioning --bucket <name> --versioning-configuration Status=Enabled
#   aws s3api put-bucket-encryption --bucket <name> \
#     --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"}}]}'
#
# Then uncomment the block below and run `terraform init -migrate-state`.
# Versioning is not optional: it is what lets you recover from a bad apply that
# corrupts state, which is the failure S3 state is actually bought for.
#
# use_lockfile replaces the old DynamoDB lock table — native S3 conditional-write
# locking, supported since AWS provider 5.x / Terraform 1.10, and one less
# resource to bootstrap and pay for.
#
# terraform {
#   backend "s3" {
#     bucket       = "vesselmind-tfstate-<account-id>"
#     key          = "eks/terraform.tfstate"
#     region       = "us-east-1"
#     encrypt      = true
#     use_lockfile = true
#   }
# }
