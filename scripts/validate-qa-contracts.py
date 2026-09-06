#!/usr/bin/env python3
"""
Lint .qa-contracts.json against the tree it describes.

    python3 scripts/validate-qa-contracts.py

WHAT THIS IS, AND DELIBERATELY IS NOT. This is a lint on the manifest FILE, not
a second implementation of the fix harness's loader. An earlier version was the
latter: it reimplemented the allow-list, the context budget and the anchor rules
in Python so it could run without a PipelineGuard checkout. That is the exact
mistake the reconcile-gate work argued against elsewhere -- two implementations
of one rule, where the one that drifts is the one nobody is watching.

So it now checks only things that are true of the manifest independent of any
harness version:

  * the JSON parses and declares a version
  * every path exists and is inside the app source the agent may read
  * every anchor matches EXACTLY ONCE (an ambiguous anchor silently hands the
    model the wrong region -- `getDocuments: async` appears in both knowledgeApi
    and sireApi, which is how this check earned its place)
  * feature ids are unique and every feature can actually match something

Budgets and slicing belong to the harness, which already refuses to guess and
records manifest_stale / manifest_ambiguous into the run's errors. This is the
same safety net, for free, before a paid run rather than during one.

Exit 0 clean, 1 with problems listed.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / ".qa-contracts.json"

# Mirrors agents/fix/paths.py. The only constant worth restating here: a path
# outside these trees can never be shown to the model, so naming one in the
# manifest is always an authoring mistake rather than a budget question.
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
    anchors = 0

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

        for entry in feature.get("context", []):
            path = entry.get("path", "")
            if not path.startswith(ALLOWED_PREFIXES):
                problems.append(f"[{fid}] {path} is outside the app source")
                continue

            target = ROOT / path
            if not target.is_file():
                problems.append(f"[{fid}] {path} does not exist")
                continue

            anchor = entry.get("anchor")
            if not anchor:
                continue

            hits = sum(1 for line in target.read_text(encoding="utf-8").splitlines()
                       if anchor in line)
            anchors += 1
            if hits == 0:
                problems.append(f"[{fid}] {path}: anchor not found: {anchor!r}")
            elif hits > 1:
                problems.append(
                    f"[{fid}] {path}: anchor matches {hits} lines, must be unique: {anchor!r}"
                )

    if problems:
        print(f"FAIL  {len(problems)} problem(s) in {MANIFEST.name}:")
        for p in problems:
            print(f"  - {p}")
        return 1

    print(f"ok    {MANIFEST.name}: {len(seen_ids)} features, {anchors} anchors, all unique")
    return 0


if __name__ == "__main__":
    sys.exit(main())
