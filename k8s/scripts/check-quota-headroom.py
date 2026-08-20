#!/usr/bin/env python3
"""Assert that an overlay's ResourceQuota can actually accommodate the workloads
it declares, at their MAXIMUM size.

WHY THIS EXISTS
A ResourceQuota that is smaller than the workloads' peak demand does not fail at
apply time — it fails later, silently and confusingly: the HPA reports
desired: 20, the ReplicaSet emits FailedCreate "exceeded quota", and pods simply
never appear. The autoscaler looks like it is working.

WHAT IT CHECKS
For each workload it takes the largest replica count that can legitimately be
requested — an HPA's maxReplicas where one targets the workload, otherwise
spec.replicas (defaulting to 1) — multiplies by the per-container requests, sums
across the namespace, and compares against requests.cpu / requests.memory.

Usage:  kubectl kustomize k8s/overlays/prod | python3 k8s/scripts/check-quota-headroom.py prod
"""
import sys, yaml

CPU_SUFFIX = {"m": 0.001, "": 1.0}
MEM_SUFFIX = {"Ki": 2**10, "Mi": 2**20, "Gi": 2**30, "Ti": 2**40,
              "K": 10**3, "M": 10**6, "G": 10**9, "T": 10**12, "": 1}


def parse(value, table):
    if value is None:
        return 0.0
    s = str(value)
    for suffix in sorted(table, key=len, reverse=True):
        if suffix and s.endswith(suffix):
            return float(s[: -len(suffix)]) * table[suffix]
    return float(s) * table[""]


cpu = lambda v: parse(v, CPU_SUFFIX)
mem = lambda v: parse(v, MEM_SUFFIX)


def main() -> int:
    label = sys.argv[1] if len(sys.argv) > 1 else "overlay"
    docs = [d for d in yaml.safe_load_all(sys.stdin) if d]

    quota = next((d for d in docs if d["kind"] == "ResourceQuota"), None)
    if quota is None:
        print(f"{label}: no ResourceQuota — nothing to check")
        return 0

    # LimitRange defaults count toward the quota for containers that declare no
    # limits, so they have to be part of the arithmetic.
    lr = next((d for d in docs if d["kind"] == "LimitRange"), None)
    default_lim_cpu = default_lim_mem = 0.0
    if lr:
        for item in lr["spec"]["limits"]:
            if item.get("type") == "Container":
                default_lim_cpu = cpu((item.get("default") or {}).get("cpu"))
                default_lim_mem = mem((item.get("default") or {}).get("memory"))

    # Highest replica count each workload can legitimately reach.
    hpa_max = {
        (d["spec"]["scaleTargetRef"]["kind"], d["spec"]["scaleTargetRef"]["name"]): d["spec"]["maxReplicas"]
        for d in docs
        if d["kind"] == "HorizontalPodAutoscaler"
    }

    totals = {"requests.cpu": 0.0, "requests.memory": 0.0,
              "limits.cpu": 0.0, "limits.memory": 0.0}
    rows = []
    for d in docs:
        kind = d["kind"]
        if kind not in ("Deployment", "StatefulSet"):
            continue  # Jobs/CronJobs are transient; counted as headroom below
        name = d["metadata"]["name"]
        replicas = hpa_max.get((kind, name), d["spec"].get("replicas", 1))
        pod = d["spec"]["template"]["spec"]
        acc = {k: 0.0 for k in totals}
        for container in pod.get("initContainers", []) + pod["containers"]:
            res = container.get("resources") or {}
            req, lim = res.get("requests") or {}, res.get("limits") or {}
            acc["requests.cpu"] += cpu(req.get("cpu"))
            acc["requests.memory"] += mem(req.get("memory"))
            # A container with no limit is unbounded, but the LimitRange default
            # applies at admission — so an absent limit is NOT zero. Fall back to
            # the namespace default so the arithmetic matches what the API server
            # will actually count.
            acc["limits.cpu"] += cpu(lim.get("cpu")) if lim.get("cpu") else default_lim_cpu
            acc["limits.memory"] += mem(lim.get("memory")) if lim.get("memory") else default_lim_mem
        for k in totals:
            totals[k] += acc[k] * replicas
        rows.append((f"{kind}/{name}", replicas,
                     acc["requests.cpu"] * replicas, acc["requests.memory"] * replicas))

    hard = quota["spec"]["hard"]

    print(f"\n{label}: peak workload demand vs ResourceQuota")
    print(f"  {'workload':28s} {'max pods':>8s} {'req cpu':>9s} {'req mem':>10s}")
    for nm, r, c, m in sorted(rows):
        print(f"  {nm:28s} {r:>8d} {c:>8.2f}  {m/2**30:>8.2f}Gi")

    failed = False
    for key, value in sorted(totals.items()):
        allowed = cpu(hard.get(key)) if key.endswith("cpu") else mem(hard.get(key))
        if hard.get(key) is None:
            continue
        fmt = (lambda v: f"{v:.2f}") if key.endswith("cpu") else (lambda v: f"{v/2**30:.2f}Gi")
        if value > allowed:
            print(f"  FAIL {key:16s} peak {fmt(value):>9s} > quota {fmt(allowed):>9s}"
                  f"  — pods rejected with 'exceeded quota' before the ceiling is reached")
            failed = True
        else:
            head = (allowed - value) / allowed * 100 if allowed else 0
            print(f"  ok   {key:16s} peak {fmt(value):>9s} <= quota {fmt(allowed):>9s}"
                  f"  ({head:.0f}% headroom for batch Jobs)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
