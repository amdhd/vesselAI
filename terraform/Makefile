# VesselMind — EKS lifecycle.
#
# `make help` lists the targets. `make destroy` is the one to read about before
# you run anything, and the reason it was written on day one — before a single
# .tf file existed — is that the entire cost risk of this cluster is nobody
# remembering to tear it down. At ~$0.37/hr a forgotten cluster is $267/month.
#
# WHY THIS IS NOT JUST `terraform destroy`
#
# Two of the most expensive objects in a running cluster are not in Terraform
# state, because Terraform did not create them:
#
#   - The ALB. Created by the AWS Load Balancer Controller in response to the
#     Ingress in k8s/base/10-ingress.yaml. Terraform has never heard of it.
#   - The EBS volumes behind the Postgres and pg_dump PVCs. Created by the EBS
#     CSI driver in response to a PVC. Same story.
#
# `terraform destroy` therefore leaves both running and billing, and then
# usually fails anyway: the ALB's ENIs sit in the subnets and the VPC delete
# blocks on them until it times out. The fix is ordering, not -force.
#
# THE ORDER, AND WHAT ENFORCES IT
#
#   1. Delete the Argo CD Applications. syncPolicy.automated is on
#      (k8s/argocd/01-application.yaml), so an auto-sync firing mid-teardown
#      re-creates what step 2 just removed. selfHeal is false, so Argo will not
#      fight a manual delete — but a git poll still triggers a full sync, and
#      that is enough. Deleting the Application first removes the whole tree via
#      its resources-finalizer.
#
#   2. Delete the namespaces. This is deliberately NOT a targeted `kubectl
#      delete pvc` — a PVC carries the pvc-protection finalizer and will not
#      delete while a pod mounts it, so deleting PVCs directly against a running
#      Postgres just hangs. Namespace deletion walks the dependency order for
#      you: pods terminate, then PVCs release, then PVs are deleted, then the
#      CSI driver deletes the EBS volumes.
#
#      This step is what actually deletes the ALB too. The Ingress carries the
#      controller's finalizer, and the namespace stays Terminating until the
#      controller has really called DeleteLoadBalancer and removed it. A
#      namespace that hangs here is a signal, not a nuisance — see
#      `make diagnose-stuck-namespace`.
#
#      Step 1 is conditional: Argo CD only ran on the local k3d cluster, so on
#      a fresh EKS cluster there is no applications.argoproj.io CRD and no
#      Application objects to delete. `kubectl delete ... --ignore-not-found`
#      would NOT absorb that case — a missing CRD fails in client-side API
#      discovery, which --ignore-not-found does not cover. The recipe checks
#      for the CRD first.
#
#   3. THEN terraform destroy. Not before. The AWS Load Balancer Controller and
#      the EBS CSI driver are pods on the node group; if Terraform removes the
#      node group first, the controllers that own those finalizers are gone, the
#      finalizers never clear, and the namespace is stuck forever with the ALB
#      still billing. Recovering from that means hand-deleting the ALB in the
#      console and force-patching finalizers. Steps 1 and 2 must run against a
#      fully alive cluster.
#
#   4. Check for orphans. Run BEFORE the cluster is gone as well as after —
#      once the EKS cluster and its tags are deleted, finding what it left
#      behind means eyeballing the console.
#
# WHAT THIS DOES NOT DO: it does not delete a Route 53 hosted zone created
# outside Terraform.
#
# ECR: `terraform destroy` DOES delete the repositories and their images, because
# they are in Terraform state with force_delete = true. An earlier version of
# this comment claimed they outlive the cluster; that was wrong. Deleting them is
# the right behaviour for a burst cluster — a repository left behind is a slow
# storage leak nobody checks — but it has one consequence worth knowing: the
# CI job that publishes to ECR has nothing to push to while the cluster is down,
# which is why that job is guarded on the AWS_ECR_ROLE_ARN repo variable rather
# than running unconditionally. GHCR remains the always-available registry.
#
# ---------------------------------------------------------------------------
# A PORTABILITY TRAP THAT MATTERS HERE MORE THAN USUAL
#
# macOS ships GNU Make 3.81 (2006). `.SHELLFLAGS`, the normal way to put the
# recipe shell into `set -e`, was added in 3.82 — on 3.81 it is SILENTLY
# IGNORED. An earlier draft of this file used it, and the result was that a
# failing safety guard printed its refusal and the recipe carried on to the
# delete anyway. Verified, not theorised.
#
# So every multi-line recipe below starts with an explicit `set -euo pipefail`,
# which is a shell builtin and therefore works on any make. If you ever
# reformat these recipes, keep that line. Without it the guards are decorative.
# ---------------------------------------------------------------------------

SHELL := /bin/bash

# The ordering above is the entire correctness argument of this file. `make -j`
# would be free to run the prerequisites of `destroy` concurrently, which would
# start terraform destroy while the namespaces are still terminating — the exact
# failure the ordering exists to prevent.
.NOTPARALLEL:

# Terraform cannot read `aws login`'s credential cache, and exporting a snapshot
# with `aws configure export-credentials --format env` expires mid-apply — which
# killed two applies during Phase 9. This profile wraps the login session in a
# credential_process the AWS SDK re-invokes on demand:
#
#   aws configure set credential_process \
#     "aws configure export-credentials --profile vesselmind --format process" \
#     --profile vesselmind-tf
#
# Override with AWS_PROFILE=... if your profile is named differently.
AWS_PROFILE ?= vesselmind-tf
export AWS_PROFILE

CLUSTER_NAME ?= vesselmind
REGION       ?= us-east-1
NAMESPACE    ?= vesselmind
ARGOCD_NS    ?= argocd

# 10 minutes is not arbitrary: ALB deletion is the slow link, typically 2-4
# minutes, and the namespace cannot finish until it completes. Too short a
# timeout looks identical to a stuck finalizer.
WAIT ?= 10m

# WHO CAN REACH THE KUBERNETES API SERVER.
#
# api_public_access_cidrs has no default in variables.tf — deliberately, so that
# no apply can silently inherit "the whole internet". That makes supplying it
# this Makefile's job, and the only answer that is both safe and unattended is
# "the machine running the apply".
#
# Recursive `=`, not `:=`. With `:=` this curl would run on EVERY make
# invocation including `make help`, which is a network call to print a help
# screen. Deferred, it runs only inside the recipes that expand TF_VARS.
#
# checkip.amazonaws.com returns a bare IP and nothing else, which is why it is
# preferred here over the various services that wrap it in JSON.
OPERATOR_CIDR = $(shell curl -fsS --max-time 5 https://checkip.amazonaws.com 2>/dev/null)/32

TF_VARS = -var="cluster_name=$(CLUSTER_NAME)" \
          -var="region=$(REGION)" \
          -var='api_public_access_cidrs=["$(OPERATOR_CIDR)"]'

.DEFAULT_GOAL := help
.PHONY: help init plan apply destroy destroy-apps destroy-infra \
        check-orphans diagnose-stuck-namespace guard-context guard-cidr

help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-26s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  CLUSTER_NAME=$(CLUSTER_NAME)  REGION=$(REGION)  NAMESPACE=$(NAMESPACE)"

# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------

# The single most dangerous thing this Makefile could do is run against the
# laptop. A k3d context and an EKS context both answer `kubectl delete namespace
# vesselmind` cheerfully, and only one of them is what you meant. EKS contexts
# are ARNs: arn:aws:eks:<region>:<account>:cluster/<name>, so requiring the
# ":cluster/<name>" suffix excludes every k3d context by construction.
guard-context:
	@set -euo pipefail; \
	ctx="$$(kubectl config current-context 2>/dev/null || echo none)"; \
	if [[ "$$ctx" != *":cluster/$(CLUSTER_NAME)" ]]; then \
	  echo "ERROR: kubectl context is '$$ctx'."; \
	  echo "That is not the EKS cluster '$(CLUSTER_NAME)'. Refusing to delete anything."; \
	  echo ""; \
	  echo "  aws eks update-kubeconfig --name $(CLUSTER_NAME) --region $(REGION)"; \
	  exit 1; \
	fi; \
	echo "==> context: $$ctx"

# A failed IP lookup must not become an apply. Without this check, a curl that
# times out on a flaky network expands OPERATOR_CIDR to the bare string "/32",
# and terraform is handed api_public_access_cidrs=["/32"] — which fails, but
# late, with an AWS-side CIDR parse error that reads like a bug in the config
# rather than a network blip.
#
# The regex is deliberately loose about the octets: this is checking that the
# lookup returned something IP-SHAPED, not validating the address. AWS rejects
# a genuinely malformed CIDR itself, and duplicating that here would just be a
# second thing to keep correct.
guard-cidr:
	@set -euo pipefail; \
	cidr="$(OPERATOR_CIDR)"; \
	if ! [[ "$$cidr" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/32$$ ]]; then \
	  echo "ERROR: could not determine this machine's public IP (got '$$cidr')."; \
	  echo ""; \
	  echo "The API server's public endpoint is restricted to a named CIDR and"; \
	  echo "there is no default, so this cannot proceed on a guess. Set it:"; \
	  echo ""; \
	  echo "  make $(MAKECMDGOALS) OPERATOR_CIDR=\$$(curl -s https://checkip.amazonaws.com)/32"; \
	  exit 1; \
	fi; \
	echo "==> API server public endpoint will allow: $$cidr"

# ---------------------------------------------------------------------------
# Build up
# ---------------------------------------------------------------------------

init: ## terraform init
	terraform init

plan: guard-cidr ## terraform plan
	terraform plan $(TF_VARS)

apply: guard-cidr ## terraform apply, then write the kubeconfig entry
	@set -euo pipefail; \
	terraform apply $(TF_VARS); \
	aws eks update-kubeconfig --name $(CLUSTER_NAME) --region $(REGION)

# ---------------------------------------------------------------------------
# Tear down
# ---------------------------------------------------------------------------

destroy: destroy-apps check-orphans destroy-infra ## FULL teardown, correctly ordered (this is the one you want)
	@set -euo pipefail; \
	echo ""; \
	echo "==> Terraform is done. Re-checking for objects it does not own."; \
	$(MAKE) --no-print-directory check-orphans; \
	echo ""; \
	echo "==> Teardown complete. Anything still listed above is billing. Delete it by hand."

destroy-apps: ## Step 1-2: remove Argo apps + namespaces so the ALB and EBS volumes are really deleted
	@set -euo pipefail; \
	if ! kubectl cluster-info --request-timeout=10s >/dev/null 2>&1; then \
	  echo "==> Cluster unreachable. Skipping in-cluster teardown."; \
	  echo "    If it is already destroyed this is fine — but run 'make check-orphans',"; \
	  echo "    because an unreachable cluster cannot have cleaned up after itself."; \
	  exit 0; \
	fi; \
	$(MAKE) --no-print-directory guard-context; \
	echo "==> 1/2 Deleting Argo CD Applications (stops auto-sync re-creating what we delete)"; \
	if kubectl get crd applications.argoproj.io >/dev/null 2>&1; then \
	  kubectl delete application vesselmind vesselmind-monitoring \
	    -n $(ARGOCD_NS) --ignore-not-found --timeout=$(WAIT); \
	else \
	  echo "    Argo CD is not installed on this cluster (no applications.argoproj.io"; \
	  echo "    CRD) — nothing to delete. Skipping to step 2."; \
	fi; \
	echo "==> Ingresses this cluster still owns, before we start:"; \
	kubectl get ingress -A --no-headers --request-timeout=30s 2>/dev/null || true; \
	echo "==> 2/2 Deleting namespaces (cascades: pods -> PVCs -> PVs -> EBS; Ingress -> ALB)"; \
	echo "    Expect this to sit for a few minutes. It is waiting on DeleteLoadBalancer,"; \
	echo "    which is the point — a fast return here would mean the ALB was orphaned."; \
	kubectl delete namespace $(NAMESPACE) --ignore-not-found --timeout=$(WAIT); \
	kubectl delete namespace $(ARGOCD_NS) --ignore-not-found --timeout=$(WAIT); \
	echo "==> Namespaces gone. Safe to destroy the infrastructure."

# AUTO_APPROVE=1 skips terraform's interactive confirmation.
#
# Not the default, because `destroy` should make you look at the plan once. But
# WITHOUT this escape hatch the target is unusable from any non-interactive
# context — a script, CI, or an agent — and fails with
#
#   Error: error asking for approval: EOF
#
# AFTER destroy-apps has already deleted every namespace. That is the worst
# possible stopping point: the application is gone and the infrastructure is
# still billing, which is precisely the state `make destroy` exists to avoid.
APPROVE := $(if $(AUTO_APPROVE),-auto-approve,)

destroy-infra: guard-cidr ## Step 3: terraform destroy (only safe AFTER destroy-apps). AUTO_APPROVE=1 to skip the prompt.
	terraform destroy $(APPROVE) $(TF_VARS)

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------

check-orphans: ## Step 4: list AWS objects Terraform does not own and may have left behind
	@echo "==> Load balancers / target groups tagged for $(CLUSTER_NAME)"
	@aws resourcegroupstaggingapi get-resources \
	  --region $(REGION) \
	  --tag-filters "Key=elbv2.k8s.aws/cluster,Values=$(CLUSTER_NAME)" \
	  --query 'ResourceTagMappingList[].ResourceARN' --output text 2>/dev/null || true
	@echo "==> Unattached EBS volumes created for a PVC (status=available means nothing is using it and it is still billing)"
	@aws ec2 describe-volumes \
	  --region $(REGION) \
	  --filters "Name=tag-key,Values=kubernetes.io/created-for/pvc/name" "Name=status,Values=available" \
	  --query 'Volumes[].[VolumeId,Size,Tags[?Key==`kubernetes.io/created-for/pvc/name`].Value|[0]]' \
	  --output text 2>/dev/null || true
	@echo "==> ENIs still referencing the cluster (these are what make a VPC delete hang)"
	@aws ec2 describe-network-interfaces \
	  --region $(REGION) \
	  --filters "Name=description,Values=*$(CLUSTER_NAME)*" \
	  --query 'NetworkInterfaces[].[NetworkInterfaceId,Status,Description]' \
	  --output text 2>/dev/null || true
	@echo "==> NAT gateways still alive in this region (\$$0.045/hr each)"
	@aws ec2 describe-nat-gateways \
	  --region $(REGION) \
	  --filter "Name=state,Values=available" \
	  --query 'NatGateways[].[NatGatewayId,VpcId]' --output text 2>/dev/null || true
	@echo "==> (ECR is not checked here: terraform destroy owns those repositories and deletes them.)"

# If destroy-apps times out, the namespace is stuck on a finalizer. Do not reach
# for the force-patch first: a finalizer that will not clear almost always means
# the controller that owns it is gone or broken, and force-patching it strands
# the real AWS object with nothing left recording that it existed.
diagnose-stuck-namespace: ## Why is a namespace stuck in Terminating?
	@echo "==> Namespace status:"
	@kubectl get namespace $(NAMESPACE) -o jsonpath='{.status}' | tr ',' '\n' || true
	@echo ""
	@echo "==> Objects still present in it:"
	@kubectl api-resources --verbs=list --namespaced -o name 2>/dev/null \
	  | xargs -n1 -I{} sh -c 'kubectl get {} -n $(NAMESPACE) --no-headers 2>/dev/null | sed "s|^|{}/|"' \
	  | grep -v '^$$' || true
	@echo ""
	@echo "==> Is the AWS Load Balancer Controller alive? If not, THAT is the cause:"
	@kubectl get pods -n kube-system -l app.kubernetes.io/name=aws-load-balancer-controller || true
	@echo ""
	@echo "If the controller is dead, restore it and let it finish the deletion properly."
	@echo "Force-patching the finalizer leaves a real ALB running with nothing tracking it."
