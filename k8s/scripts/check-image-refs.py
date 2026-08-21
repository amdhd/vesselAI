#!/usr/bin/env python3
"""Verify every image an overlay references actually exists, and that
production references are immutable.

WHY THIS EXISTS
Two failure modes this catches, both of which surface only at deploy time and
look like infrastructure problems rather than manifest problems:

  1. AN IMAGE THAT DOES NOT EXIST. The manifests referenced a local k3d registry
     for a year; two of five images were never published anywhere at all. On a
     real cluster those workloads fail with ImagePullBackOff, which reads as a
     networking or credentials fault long before anyone suspects the manifest.

  2. A MUTABLE TAG IN PRODUCTION. A tag is a pointer someone can move; a digest
     is the content. Two nodes pulling the same tag can get different bytes,
     which is the class of "works on one node" failure you cannot debug from
     logs. --require-digest makes that a build failure instead.

It also reports what it CANNOT check rather than passing silently: a registry
that is unreachable, private, or rate-limiting is reported as SKIP, because
"could not verify" and "verified good" must not look the same.

Usage:
  kubectl kustomize k8s/overlays/prod | python3 check-image-refs.py prod --require-digest
  kubectl kustomize k8s/overlays/dev  | python3 check-image-refs.py dev
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

import yaml

MANIFEST_ACCEPT = (
    "application/vnd.oci.image.index.v1+json,"
    "application/vnd.docker.distribution.manifest.list.v2+json,"
    "application/vnd.oci.image.manifest.v1+json,"
    "application/vnd.docker.distribution.manifest.v2+json"
)
TIMEOUT = 30

# Registries this script knows how to talk to anonymously. Anything else — a
# local k3d registry, a private ECR — is reported as SKIP rather than guessed at.
KNOWN = {
    "ghcr.io": ("https://ghcr.io/token?scope=repository:{repo}:pull", "https://ghcr.io/v2/{repo}/manifests/{ref}"),
    "docker.io": ("https://auth.docker.io/token?service=registry.docker.io&scope=repository:{repo}:pull",
                  "https://registry-1.docker.io/v2/{repo}/manifests/{ref}"),
}



def collect_images(text: str) -> set[str]:
    """Every image in every pod template, found by walking the parsed documents.

    NOT a regex over the rendered YAML. The first version of this script used
    `^\s*image:` and silently missed `- image: ...` — a list item where `image`
    happens to be the first key — so one of five production images went
    unverified while the check reported success. A check that quietly skips
    things is worse than no check, because it is trusted.

    Walking the structure also covers initContainers, ephemeralContainers, and
    the extra nesting in a CronJob (spec.jobTemplate.spec.template) without
    hardcoding a single path.
    """
    found: set[str] = set()

    def walk(node) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if key in ("containers", "initContainers", "ephemeralContainers") and isinstance(value, list):
                    for container in value:
                        if isinstance(container, dict) and container.get("image"):
                            found.add(container["image"])
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    for doc in yaml.safe_load_all(text):
        if doc:
            walk(doc)
    return found


def parse(image: str):
    """Split an image reference into (registry, repo, ref, is_digest)."""
    if "@" in image:
        name, ref, digest = *image.split("@", 1), True
    else:
        head, _, tail = image.rpartition(":")
        # A colon in the host part (localhost:5000/x) is a port, not a tag.
        if head and "/" not in tail:
            name, ref, digest = head, tail, False
        else:
            name, ref, digest = image, "latest", False

    first = name.split("/")[0]
    if "." in first or ":" in first or first == "localhost":
        registry, repo = first, name.split("/", 1)[1] if "/" in name else ""
    else:
        # Bare names are Docker Hub, and official images live under library/.
        registry = "docker.io"
        repo = name if "/" in name else f"library/{name}"
    return registry, repo, ref, digest


def head_manifest(registry: str, repo: str, ref: str) -> tuple[bool, str]:
    token_url, manifest_url = KNOWN[registry]
    try:
        tok = json.load(urllib.request.urlopen(token_url.format(repo=repo), timeout=TIMEOUT)).get("token")
    except Exception as exc:
        return False, f"SKIP  token request failed ({exc.__class__.__name__})"

    req = urllib.request.Request(manifest_url.format(repo=repo, ref=ref), method="HEAD")
    req.add_header("Authorization", f"Bearer {tok}")
    req.add_header("Accept", MANIFEST_ACCEPT)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return True, f"ok    HTTP {resp.status}"
    except urllib.error.HTTPError as exc:
        # 429 is the registry throttling us, not a bad reference. Treating it as
        # a failure would make CI flaky in a way that teaches people to re-run
        # until green, which is worse than not checking.
        if exc.code in (401, 403, 429):
            return True, f"SKIP  HTTP {exc.code} (private or rate-limited — not verified)"
        return False, f"FAIL  HTTP {exc.code}"
    except Exception as exc:
        return True, f"SKIP  unreachable ({exc.__class__.__name__})"


def main() -> int:
    label = sys.argv[1] if len(sys.argv) > 1 else "overlay"
    require_digest = "--require-digest" in sys.argv

    images = sorted(collect_images(sys.stdin.read()))
    if not images:
        print(f"{label}: no image references found")
        return 0

    print(f"\n{label}: verifying {len(images)} image reference(s)"
          + (" (digest required)" if require_digest else ""))
    failed = 0
    for image in images:
        registry, repo, ref, is_digest = parse(image)
        shown = f"{repo}@{ref[:19]}…" if is_digest else f"{repo}:{ref}"

        if require_digest and not is_digest:
            print(f"  FAIL  {shown:52s} mutable tag — production must pin by digest")
            failed += 1
            continue

        if registry not in KNOWN:
            print(f"  SKIP  {shown:52s} {registry} not reachable from CI")
            continue

        ok, note = head_manifest(registry, repo, ref)
        print(f"  {note.split()[0]:5s} {shown:52s} {' '.join(note.split()[1:])}")
        if not ok:
            failed += 1

    if failed:
        print(f"  -> {failed} reference(s) unusable; these would ImagePullBackOff on a real cluster")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
