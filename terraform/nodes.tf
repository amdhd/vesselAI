# The managed node group, and the IAM role its instances run as.
#
# MANAGED node group rather than self-managed EC2 or Fargate:
#   - Self-managed means owning the AMI, the userdata bootstrap and the upgrade
#     dance. That is a lot of undifferentiated work to demonstrate nothing.
#   - Fargate has no nodes at all, which sounds attractive until you notice it
#     cannot run DaemonSets, does not support the EBS CSI driver, and would
#     make `kubectl drain` — a Phase 2 and Phase 7 exercise — meaningless.
#   - Managed gives real nodes to drain and cordon, with AWS handling the AMI.

data "aws_iam_policy_document" "node_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "node" {
  name               = "${var.cluster_name}-node"
  assume_role_policy = data.aws_iam_policy_document.node_assume_role.json
}

resource "aws_iam_role_policy_attachment" "node" {
  for_each = toset([
    # Lets the kubelet register with the control plane and describe its own
    # instance. Without it nodes boot, run, and never join.
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",

    # The VPC CNI's permission to attach ENIs and hand pod IPs out of the
    # subnet. NOTE: this is on the NODE role, which means every pod on the node
    # inherits it — exactly the sharing problem IRSA exists to solve. AWS's own
    # recommendation is to move the CNI onto IRSA too. Left here deliberately:
    # doing it properly needs its own role and a service-account annotation, and
    # this phase already has two IRSA consumers to build. Worth naming as a
    # known gap rather than leaving it looking accidental.
    "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",

    # THE PAYOFF FOR CHOOSING ECR. This is what lets a node pull from ECR with
    # no imagePullSecret anywhere in the cluster — the node's own IAM identity
    # authorises the pull, so there is no registry credential to rotate, leak,
    # or forget to copy into a new namespace. ReadOnly: nodes pull, CI pushes.
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
  ])

  role       = aws_iam_role.node.name
  policy_arn = each.value
}

resource "aws_eks_node_group" "main" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "${var.cluster_name}-nodes"
  node_role_arn   = aws_iam_role.node.arn

  # PRIVATE subnets only. Nodes have no public IP and no inbound route from the
  # internet; the ALB in the public tier is the only way traffic reaches them,
  # and their egress goes out through the NAT gateway.
  subnet_ids = aws_subnet.private[*].id

  instance_types = var.node_instance_types
  capacity_type  = var.node_capacity_type
  disk_size      = var.node_disk_size

  # AL2023, not AL2. Amazon Linux 2 is end-of-life for EKS and is not offered
  # for 1.33 and later at all. AL2023 uses nodeadm rather than the old
  # bootstrap.sh, which matters only if you go self-managed later.
  ami_type = "AL2023_x86_64_STANDARD"

  scaling_config {
    desired_size = var.node_desired_size
    min_size     = var.node_min_size
    max_size     = var.node_max_size
  }

  update_config {
    # One node at a time during a version upgrade, so the other keeps serving.
    # With min_size 2 this is what makes a rolling node upgrade survivable — and
    # it is the node-level analogue of the PodDisruptionBudget from Phase 7.
    max_unavailable = 1
  }

  # POD DENSITY IS CAPPED BY ENIs, NOT MEMORY. A t3.medium allows only
  # 3 ENIs x (6 IPs - 1) + 2 = 17 pods per node by default — 51 across three
  # nodes, against a peak here of roughly 57. That shortfall is why the vpc-cni
  # addon in addons.tf turns on prefix delegation, which raises the ceiling to
  # 110 per node. The two settings are a pair: changing the instance type back
  # to something larger would make prefix delegation optional again, and
  # dropping prefix delegation while keeping t3.medium reintroduces the limit.

  depends_on = [aws_iam_role_policy_attachment.node]

  tags = { Name = "${var.cluster_name}-nodes" }

  lifecycle {
    # The cluster autoscaler (not installed) or a manual scale changes
    # desired_size out from under Terraform. Ignoring it means a later apply
    # does not yank a scaled-up cluster back down to 2 — the same reasoning as
    # the prod overlay leaving /spec/replicas to the HPA.
    ignore_changes = [scaling_config[0].desired_size]
  }
}
