# The network the cluster lives in.
#
# Lifted from PipelineGuard's networking module (2 public + 2 private subnets
# across 2 AZs, one NAT), with the EKS-specific corrections it could not have
# had — it was built for ECS and never needed subnet discovery tags.
#
# THE SHAPE, and why:
#   public subnets  -> the ALB, and the NAT gateway. Internet-reachable.
#   private subnets -> the nodes. No inbound route from the internet at all.
#
# Nodes could have gone in the public subnets with public IPs and no NAT,
# saving $0.05/hr. Rejected: "the workload sits in a private subnet and reaches
# out through a NAT" is the shape every real cluster has, and the IRSA and
# security-group work later in this phase is only interesting against it. The
# saving is $3.60 over a three-day burst, which is not a reason to build the
# unrealistic version.

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr

  # BOTH are required by EKS, not optional hygiene. Without DNS hostnames and
  # DNS support the kubelet cannot resolve the API server endpoint and nodes
  # never join — a failure that shows up as nodes simply missing, with nothing
  # useful in the console.
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "${var.cluster_name}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.cluster_name}-igw" }
}

# --- Subnets ---------------------------------------------------------------
#
# cidrsubnet(10.0.0.0/16, 8, N) carves /24s. Public get 10.0.0.0/24 and
# 10.0.1.0/24; private are offset by 10 to 10.0.10.0/24 and 10.0.11.0/24, so the
# two ranges stay visually distinct in flow logs and security group rules.

resource "aws_subnet" "public" {
  count                   = var.az_count
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = false # the ALB brings its own public IPs; nothing else launches here

  tags = {
    Name = "${var.cluster_name}-public-${count.index}"

    # *** LOAD-BEARING, AND SILENT WHEN WRONG ***
    #
    # This tag is how the AWS Load Balancer Controller discovers where it is
    # allowed to place an internet-facing ALB. Without it the controller finds
    # no eligible subnets and creates nothing — and the Ingress object shows no
    # error, because the Ingress is only a rule and knows nothing about ALBs.
    # Same failure signature as an Ingress with no controller installed, which
    # is the failure k8s/base/10-ingress.yaml already warns about.
    #
    # Debug it with: kubectl -n kube-system logs deploy/aws-load-balancer-controller
    "kubernetes.io/role/elb" = "1"

    # Ownership tag. With one cluster per VPC the controller can infer this, but
    # stating it means a second cluster in the same VPC later does not silently
    # start borrowing these subnets.
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  }
}

resource "aws_subnet" "private" {
  count             = var.az_count
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name = "${var.cluster_name}-private-${count.index}"

    # The private-subnet counterpart: where an INTERNAL load balancer may go.
    # Nothing in this project creates one today. It is here because the pair is
    # what makes the scheme legible — "elb here, internal-elb there" — and
    # adding it later means re-tagging live subnets.
    "kubernetes.io/role/internal-elb"           = "1"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  }
}

# --- Egress ----------------------------------------------------------------

resource "aws_eip" "nat" {
  domain     = "vpc"
  depends_on = [aws_internet_gateway.main]
  tags       = { Name = "${var.cluster_name}-nat" }
}

resource "aws_nat_gateway" "main" {
  # ONE NAT gateway, in the first AZ, shared by every private subnet.
  #
  # THE TRADEOFF, stated so it is a decision and not an accident: production
  # runs one NAT per AZ, because this arrangement means an AZ-a outage removes
  # egress from AZ-b's nodes as well — they route through a gateway that no
  # longer exists. Their pods keep serving traffic that is already inside the
  # cluster, but image pulls and any outbound API call fail.
  #
  # For a three-day burst that is the right trade: $0.045/hr instead of $0.09,
  # and the failure it exposes us to is one nobody is paged for.
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  depends_on    = [aws_internet_gateway.main]
  tags          = { Name = "${var.cluster_name}-nat" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${var.cluster_name}-public-rt" }
}

resource "aws_route_table" "private" {
  # One private route table, not one per AZ, because there is only one NAT for
  # them to point at. The moment a second NAT is added this must become
  # count = var.az_count with each table pointing at its own AZ's gateway —
  # otherwise the second NAT is paid for and never used.
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
  tags = { Name = "${var.cluster_name}-private-rt" }
}

resource "aws_route_table_association" "public" {
  count          = var.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = var.az_count
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# Claim the VPC's default security group and give it no rules, so nothing can
# accidentally land on an open-by-default firewall. Nothing uses it.
resource "aws_default_security_group" "default" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.cluster_name}-default-locked" }
}
