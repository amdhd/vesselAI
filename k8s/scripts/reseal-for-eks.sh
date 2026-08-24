#!/usr/bin/env bash
#
# Re-seal the application secrets against an EKS cluster's Sealed Secrets key.
#
# WHY THIS IS NEEDED AT ALL
#
# A SealedSecret is encrypted to ONE controller's public key. The controller
# generates its keypair on first start and keeps the private half in a Secret in
# kube-system, which is deliberately not in git. A fresh cluster therefore has a
# NEW key, and k8s/base/02-sealedsecret.yaml — sealed against the k3d cluster —
# cannot be decrypted on EKS.
#
# The failure is quiet, which is what makes it worth a script: the SealedSecret
# applies cleanly, `kubectl get sealedsecret` looks healthy, and only the
# controller log mentions a decryption error. No Secret is ever created, so pods
# sit in CreateContainerConfigError waiting on a reference that will never
# resolve.
#
# WHAT IT PRODUCES
#
# k8s/overlays/prod/sealedsecret-patch.yaml — a patch replacing encryptedData
# for the EKS cluster. The base SealedSecret stays untouched, so k3d keeps
# working.
#
# WHAT IT DOES WITH VALUES
#
# POSTGRES_PASSWORD and JWT_SECRET are GENERATED FRESH here rather than copied
# from the laptop. That is not extra work for its own sake: reusing a
# development database password on an internet-facing cluster means one
# compromise is two, and a JWT secret shared between environments means a token
# minted locally is valid in the cloud. DATABASE_URL is derived from the
# generated password, so the three stay consistent by construction.
#
# ANTHROPIC_API_KEY is the one value that cannot be invented. Supply it in the
# environment; it is never written to disk in plaintext by this script.
#
# USAGE
#   export ANTHROPIC_API_KEY=sk-ant-...
#   ./k8s/scripts/reseal-for-eks.sh
#
set -euo pipefail

NAMESPACE="${NAMESPACE:-vesselmind}"
SECRET_NAME="${SECRET_NAME:-vesselmind-secrets}"
CONTROLLER_NAME="${CONTROLLER_NAME:-sealed-secrets-controller}"
CONTROLLER_NS="${CONTROLLER_NS:-kube-system}"
OUT="k8s/overlays/prod/sealedsecret-patch.yaml"

# --- preconditions ---------------------------------------------------------
# Every one of these has a failure mode that is confusing if it surfaces later
# instead of here.

command -v kubeseal >/dev/null || { echo "ERROR: kubeseal not installed."; exit 1; }
command -v kubectl  >/dev/null || { echo "ERROR: kubectl not installed."; exit 1; }

ctx="$(kubectl config current-context 2>/dev/null || echo none)"
if [[ "$ctx" != *":cluster/"* ]]; then
  echo "ERROR: kubectl context is '$ctx', which is not an EKS cluster."
  echo "Sealing against the wrong cluster produces a file that silently fails"
  echo "to decrypt on the cluster you meant. Refusing."
  echo "  aws eks update-kubeconfig --name vesselmind --region us-east-1 --profile vesselmind"
  exit 1
fi
echo "==> context: $ctx"

if ! kubectl -n "$CONTROLLER_NS" get deploy "$CONTROLLER_NAME" >/dev/null 2>&1; then
  echo "ERROR: no $CONTROLLER_NAME in $CONTROLLER_NS."
  echo "Apply k8s/aws/sealed-secrets first and wait for it to be Ready — the"
  echo "controller must have generated its keypair before anything can be"
  echo "sealed against it."
  exit 1
fi
kubectl -n "$CONTROLLER_NS" rollout status "deploy/$CONTROLLER_NAME" --timeout=120s >/dev/null

: "${ANTHROPIC_API_KEY:?ERROR: set ANTHROPIC_API_KEY in the environment. It is the one value this script cannot generate.}"

# --- values ----------------------------------------------------------------
# openssl rather than $RANDOM: this needs a cryptographically secure source, and
# the shell's RNG is neither secure nor high-entropy.
#
# tr -d '/+=' keeps the password free of characters that would need percent-
# encoding inside DATABASE_URL — a base64 password containing '/' produces a
# connection string that parses wrongly and fails with an authentication error
# that looks like a bad password, which it technically is.
POSTGRES_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
JWT_SECRET="$(openssl rand -base64 48 | tr -d '/+=' | head -c 48)"
DATABASE_URL="postgresql://vesselmind:${POSTGRES_PASSWORD}@postgres:5432/vesselmind?schema=public"

echo "==> generated fresh POSTGRES_PASSWORD (32 chars) and JWT_SECRET (48 chars)"
echo "==> reusing ANTHROPIC_API_KEY from the environment"

# --- seal ------------------------------------------------------------------
# The plaintext Secret is piped straight into kubeseal and never written to
# disk. --dry-run=client means it is not created in the cluster either; the only
# artefact is the encrypted output.
kubectl create secret generic "$SECRET_NAME" \
  --namespace "$NAMESPACE" \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=DATABASE_URL="$DATABASE_URL" \
  --from-literal=JWT_SECRET="$JWT_SECRET" \
  --from-literal=ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  --dry-run=client -o yaml \
| kubeseal \
    --controller-name "$CONTROLLER_NAME" \
    --controller-namespace "$CONTROLLER_NS" \
    --format yaml \
    --scope strict \
> /tmp/sealed-full.yaml

# Extract just encryptedData into a patch. Emitting the whole SealedSecret as an
# overlay resource would collide with the base's object of the same name;
# a patch replaces the field and leaves everything else to the base.
{
  echo "# GENERATED by k8s/scripts/reseal-for-eks.sh — do not hand-edit."
  echo "#"
  echo "# Sealed against the EKS cluster's Sealed Secrets key. These values"
  echo "# CANNOT be decrypted by the k3d cluster, and the base's values cannot be"
  echo "# decrypted here — that is the intended behaviour, not a problem to fix."
  echo "#"
  echo "# --scope strict: this ciphertext is bound to BOTH the namespace and the"
  echo "# secret name. Moving it to another namespace, or renaming the Secret,"
  echo "# makes it undecryptable. That is the safest of the three scopes and the"
  echo "# reason is worth knowing: cluster-wide scope would let anyone who can"
  echo "# create a SealedSecret in any namespace decrypt these values."
  echo "apiVersion: bitnami.com/v1alpha1"
  echo "kind: SealedSecret"
  echo "metadata:"
  echo "  name: $SECRET_NAME"
  echo "  namespace: $NAMESPACE"
  echo "spec:"
  echo "  encryptedData:"
  data-platform/.venv/bin/python - <<'PY'
import yaml
d = yaml.safe_load(open("/tmp/sealed-full.yaml"))
for k, v in sorted(d["spec"]["encryptedData"].items()):
    print(f"    {k}: {v}")
PY
} > "$OUT"

rm -f /tmp/sealed-full.yaml

echo "==> wrote $OUT"
echo
echo "Next:"
echo "  1. Add it to k8s/overlays/prod/kustomization.yaml under patches: if not already there."
echo "  2. Commit it. The ciphertext is safe to commit — that is the entire point."
echo "  3. Argo CD syncs it; the controller decrypts it into a real Secret."
echo
echo "The generated password and JWT secret exist ONLY inside the sealed file."
echo "Nothing here holds a plaintext copy, so rotating means re-running this."
