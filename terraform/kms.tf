# Envelope encryption for Kubernetes Secrets, and encryption-by-default for EBS.
#
# ---------------------------------------------------------------------------
# WHY THIS EXISTS
#
# The project already protects secrets in GIT — Phase 1 pulled Sealed Secrets
# forward precisely so a plaintext Secret would not be the first thing a
# reviewer saw in a public repo. That protects the repository, and it was always
# stated as such. It says nothing about how the decrypted Secret is stored once
# the controller has unsealed it, or about the database volume underneath it.
#
# This file closes both, and they are genuinely different problems:
#   - aws_kms_key.eks       -> how Kubernetes Secrets sit in etcd.
#   - EBS encryption default -> how the bytes on the Postgres volume sit on disk.
# ---------------------------------------------------------------------------

resource "aws_kms_key" "eks" {
  description = "Envelope encryption for ${var.cluster_name} Kubernetes Secrets"

  # Rotation is free and removes a manual task nobody remembers. The old key
  # material is retained so previously-encrypted data stays readable.
  enable_key_rotation = true

  # A week to change your mind. AWS's minimum is 7 days and its default is 30;
  # 7 is chosen because this cluster is a three-day burst and a 30-day pending
  # deletion outlives the thing it protects by an order of magnitude. On a
  # long-lived cluster this should be 30.
  deletion_window_in_days = 7

  tags = { Name = "${var.cluster_name}-eks-secrets" }
}

resource "aws_kms_alias" "eks" {
  # Keys are referenced by UUID, which is unreadable in an audit trail. The
  # alias is what makes a CloudTrail entry legible.
  name          = "alias/${var.cluster_name}-eks-secrets"
  target_key_id = aws_kms_key.eks.key_id
}

# ---------------------------------------------------------------------------
# EBS ENCRYPTION BY DEFAULT — account-wide, and that is the point.
#
# THE PROBLEM IT SOLVES: the EBS CSI driver creates a volume for every PVC. If
# the StorageClass does not ask for encryption, the volume is unencrypted, and
# nothing in the manifest makes that visible — `kubectl get pvc` looks identical
# either way. Setting the account default means every volume is encrypted no
# matter which StorageClass, snapshot or launch template created it, so a
# forgotten `encrypted: "true"` cannot silently produce plaintext storage.
#
# The gp3 StorageClass in k8s/base ALSO sets encrypted: "true". That is
# deliberate belt-and-braces: the account setting protects volumes created by
# things that are not the CSI driver, and the StorageClass setting keeps the
# manifest honest about what it requires rather than depending on ambient
# account configuration a reader cannot see.
#
# THIS IS ACCOUNT-WIDE, NOT CLUSTER-SCOPED. It affects every EBS volume created
# in us-east-1 in this account from now on, including ones unrelated to this
# project. That is the right default, but it is a wider blast radius than
# anything else in this directory and should not be a surprise.
#
# It applies to NEW volumes only. The three node root volumes created before
# this was set stay unencrypted until the nodes are recycled — see the note in
# the README section on this.
# ---------------------------------------------------------------------------
resource "aws_ebs_encryption_by_default" "main" {
  enabled = true
}
