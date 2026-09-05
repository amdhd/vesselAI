#!/usr/bin/env python3
"""
Check .qa-contracts.json against the tree it describes.

WHY THIS EXISTS SEPARATELY FROM THE FIX HARNESS. The harness already refuses to
guess: a stale or ambiguous anchor makes it show the whole file and record a
warning. But that only happens on a fix RUN, which is rare, costs money, and is
read by whoever dispatched it. A manifest silently degrading to whole-file
context between runs is exactly the kind of rot nobody notices.

This is the cheap version of the same check, runnable on every commit, needing
no AWS and no model:

    python3 scripts/validate-qa-contracts.py

It deliberately duplicates almost nothing: when the PipelineGuard harness is
available it imports the REAL loader, so the check and the runtime cannot
disagree. Without it, it falls back to the same rules implemented directly --
enough to catch a typo in a pre-commit hook on a laptop with no checkout of the
other repo.

Exit 0 clean, 1 with problems listed.
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / ".qa-contracts.json"

MAX_CONTEXT_FILES = 6
MAX_CONTEXT_BYTES = 24_000
ALLOWED_PREFIXES = ("frontend/src/", "backend/src/")


def main() -> int:
    if not MANIFEST.is_file():
        print(f"no {MANIFEST.name}; nothing to check")
        return 0

    try:
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"FAIL  {MANIFEST.name} is not valid JSON: {e}")
        return 1

    problems: list[str] = []

    if manifest.get("version") != 1:
        problems.append(f"version is {manifest.get('version')!r}, expected 1")

    seen_ids: set[str] = set()
    for feature in manifest.get("features", []):
        fid = feature.get("id", "?")
        if fid in seen_ids:
            problems.append(f"[{fid}] duplicate feature id")
        seen_ids.add(fid)

        match = feature.get("match") or {}
        if not match.get("page_prefix") and not match.get("terms"):
            problems.append(f"[{fid}] matches nothing: needs page_prefix or terms")
        if match.get("page_prefix") and not str(match["page_prefix"]).strip("/"):
            problems.append(f"[{fid}] page_prefix '/' matches every finding")

        readonly = 0
        total = 0
        for entry in feature.get("context", []):
            path = entry.get("path", "")
            target = ROOT / path

            if not path.startswith(ALLOWED_PREFIXES):
                problems.append(f"[{fid}] {path} is outside the allow-list")
                continue
            if not target.is_file():
                problems.append(f"[{fid}] {path} does not exist")
                continue

            if entry.get("editable") is True:
                continue

            readonly += 1
            text = target.read_text(encoding="utf-8")
            anchor = entry.get("anchor")
            if anchor:
                hits = [i for i, line in enumerate(text.splitlines()) if anchor in line]
                if not hits:
                    problems.append(f"[{fid}] {path}: anchor not found: {anchor!r}")
                    continue
                if len(hits) > 1:
                    # The failure that produced this check. `getDocuments: async`
                    # appears in both knowledgeApi and sireApi in one api.ts, so
                    # an anchor on it hands the model the wrong feature's slice
                    # and calls it the contract.
                    problems.append(
                        f"[{fid}] {path}: anchor matches {len(hits)} lines, must be "
                        f"unique: {anchor!r}"
                    )
                    continue
                span = entry.get("span", 24)
                lines = text.splitlines()[hits[0] : hits[0] + span]
                total += len("\n".join(lines).encode("utf-8"))
            else:
                total += len(text.encode("utf-8"))

        if readonly > MAX_CONTEXT_FILES:
            problems.append(
                f"[{fid}] {readonly} read-only entries exceeds the harness cap "
                f"({MAX_CONTEXT_FILES}); the surplus is silently withheld"
            )
        if total > MAX_CONTEXT_BYTES:
            problems.append(
                f"[{fid}] {total:,} bytes exceeds the context budget "
                f"({MAX_CONTEXT_BYTES:,})"
            )

    if problems:
        print(f"FAIL  {len(problems)} problem(s) in {MANIFEST.name}:")
        for p in problems:
            print(f"  - {p}")
        return 1

    print(f"ok    {MANIFEST.name}: {len(seen_ids)} features, every anchor unique and resolving")
    return 0


if __name__ == "__main__":
    sys.exit(main())
