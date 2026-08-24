#!/usr/bin/env bash
#
# Mirror postgres:16-alpine from Docker Hub into this account's ECR.
#
# WHY: every node in this cluster sits behind ONE NAT gateway, so they all share
# a single source IP as far as Docker Hub is concerned — and Docker Hub rate
# limits anonymous pulls per IP. A node group scaling up during a load test is
# precisely when several nodes pull at once, and precisely when being throttled
# hurts most. k8s/overlays/prod/kustomization.yaml already warns about this.
#
# Terraform creates the repository; it cannot move image bytes, which is why
# this is a script and not a resource.
#
# WHAT IT DOES NOT SOLVE: mutability. The prod overlay pins postgres by DIGEST,
# and that is what fixes the version. This only changes where the bytes are
# fetched from. The two are independent problems and the mirror repository is
# deliberately MUTABLE (see terraform/ecr.tf) because 16-alpine is itself a
# moving upstream tag.
#
set -euo pipefail

REGION="${REGION:-us-east-1}"
PROFILE="${AWS_PROFILE:-vesselmind}"
CLUSTER="${CLUSTER_NAME:-vesselmind}"
SOURCE="${SOURCE:-postgres:16-alpine}"

command -v docker >/dev/null || { echo "ERROR: docker not installed."; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: Docker daemon is not running."; exit 1; }

ACCOUNT="$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)"
REGISTRY="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
TARGET="${REGISTRY}/${CLUSTER}/postgres:16-alpine"

echo "==> ${SOURCE}  ->  ${TARGET}"

# --amd64 explicitly. The nodes are t3.medium (x86), and on an Apple Silicon
# laptop a bare `docker pull` fetches the arm64 variant — which pushes happily
# and then fails at runtime with "exec format error" on every node. That failure
# appears at pod start, long after the push looked successful.
docker pull --platform linux/amd64 "$SOURCE"

aws ecr get-login-password --region "$REGION" --profile "$PROFILE" \
  | docker login --username AWS --password-stdin "$REGISTRY"

docker tag "$SOURCE" "$TARGET"
docker push "$TARGET"

echo
echo "==> pushed. Resolve the digest for the prod overlay:"
echo "    aws ecr describe-images --profile $PROFILE --region $REGION \\"
echo "      --repository-name ${CLUSTER}/postgres --image-ids imageTag=16-alpine \\"
echo "      --query 'imageDetails[0].imageDigest' --output text"
echo
echo "Then update the postgres entry in k8s/overlays/prod/kustomization.yaml to"
echo "point newName at ${REGISTRY}/${CLUSTER}/postgres and pin that digest."
