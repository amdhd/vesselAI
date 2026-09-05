# The QA reconcile gate

How an agent-authored fix earns its way into `main`, and what to do when the
gate is red for reasons that have nothing to do with the code.

## Why it exists

PR #130 was a fix proposed by the bug-fix agent. It mis-diagnosed its own
finding — it guarded `ciiImpact` when the crash was `formatFuel(voyage.actualFuel)`
throwing on an `undefined`, because the backend had stopped sending the
`actualFuel` key at all. It compiled. It passed the existing tests, which is
everything `ci.yml` checks. It merged.

Nothing in that sequence was a bug in any one component. The gap was structural:
the only thing that could have caught the mis-fix was a browser-QA run on the fix
itself, and that run was advisory — a PR comment nobody's merge waited on.

The reconcile gate turns that verdict into a merge condition, for agent PRs only.

## What runs, and when

```
PR opened / pushed / reopened
        │
        ▼
   classify  ── head branch starts with agent-fix/ or agent-converge/ ?
        │      (a fork is never machine-verified, whatever it is named)
        │
   ┌────┴─────┐
   │          │
  no         yes
   │          │
   │          ▼
   │      qa-run.yml   browser QA against a compose stack behind a
   │          │        cloudflared tunnel; ~$0.20, ~25 min
   │          │        returns verdict: clean | blocking | infra
   ▼          ▼
  gate ◄──────┘   "Reconcile gate" — the required status check
```

A human PR spends a few seconds on two free-runner jobs and goes green. Only an
agent branch reaches the paid path.

### The three files

| File | Role |
|---|---|
| `.github/workflows/qa-run.yml` | The one implementation of a browser-QA run. `workflow_call` only; never runs on its own. |
| `.github/workflows/ui-qa-agent.yml` | Human-triggered caller — the `agent-qa` label, manual dispatch, weekly cron. Advisory. |
| `.github/workflows/qa-reconcile-gate.yml` | Machine-enforced caller. Renders the required `Reconcile gate` check. |
| `.github/actions/require-protected-base/` | The tripwire. Refuses to start a code-writing agent whose base does not require the gate. |

There is deliberately **one** QA implementation. Two would drift, and the one
that drifted would be the one deciding whether an agent's fix may merge.

## The tripwire

The gate alone is not enough, because #130 needed **two** things to be true: the
fix was unverified, *and* its base branch (`demo/d4-fixbase`, a throwaway) had no
protection at all. A check that `main` requires does nothing for a PR opened
against a branch that requires nothing.

So `agent-fix.yml` and `ui-qa-converge.yml` both read their base branch's
protection before spending a model token, and refuse unless it requires
`Reconcile gate`. A future throwaway fix base can only be used once it has been
protected.

It **fails closed**. A 404 (no protection), a 403 (the App cannot read
protection) and a network blip all end in refusal, because none of them is
evidence that the base is guarded.

Reading branch protection is an admin-scoped read: the GitHub App needs
`Administration: read`, which no workflow file can assert for itself. A 403 from
the tripwire means that grant is missing.

> **Ordering interlock, now satisfied.** The tripwire refuses any base that does
> not require `Reconcile gate`, which included `main` itself until the protection
> was applied. `main` passes as of 2026-09-05; `demo/*` and any other unprotected
> branch still refuse, which is the point. If you create a new fix base, protect
> it before pointing `fix_base` at it.

## The three verdicts

`qa-run.yml` reports the harness exit code as a named verdict, and the
distinction matters:

| Verdict | Exit | Meaning | Gate |
|---|---|---|---|
| `clean` | 0 | The agent examined the code and found nothing blocking. | 🟢 |
| `blocking` | 1 | The agent examined the code and the findings stand. **The fix did not fix it.** | 🔴 |
| `infra` | 2+ | The harness never reached a judgement — a throttle, a tunnel that never came up, a stack that would not boot. **Nothing has been said about the code.** | 🔴 |

Both failure verdicts are red, because an unverified agent fix must not merge
either way. But the annotation and the step summary always say which, and that
is what tells you whether to re-run or to go read the diff.

Collapsing these two was survivable while QA was advisory. It is not survivable
for a required check, which is why the exit code is captured by hand rather than
inferred from `steps.qa.outcome`.

## Current protection, and what it does not do

Applied to `main` on 2026-09-05:

| Setting | Value |
|---|---|
| `Reconcile gate` required | **yes** |
| Other required checks | the 6 `ci.yml` contexts, unchanged |
| `enforce_admins` | **`false`** — a deliberate choice, see below |
| `strict` (up-to-date branch) | `false`, unchanged |
| Required approvals | `0`, unchanged |

**`enforce_admins` is `false`, so a red gate does not physically stop an admin
merge.** GitHub still offers "merge without waiting for requirements" to a repo
admin. On a solo repo that is the whole population.

So be honest about what this buys. The gate turns an agent's mis-fix from
*invisible* into *loud*: #130 merged with nothing red and nothing to notice,
whereas the same PR today shows a failed required check, a verdict naming the
reason, and a QA comment on the PR. What it does not do is make the merge
impossible. Bypassing it is one click, and that click looks like an ordinary
merge in the log.

Turning `enforce_admins` on removes that click and makes the check binding on
everyone:

```bash
gh api -X POST /repos/amdhd/vesselAI/branches/main/protection/enforce_admins
```

The reason to hold off is that a red gate is not always a judgement on the code.
A Bedrock throttle, a `trycloudflare` hiccup, or a stack that will not boot all
land red as verdict `infra`, and with `enforce_admins` on there is no override —
including for the PR that would fix the gate itself. The escape hatch would then
be to lower the protection deliberately, merge, and restore it:

```bash
gh api -X DELETE /repos/amdhd/vesselAI/branches/main/protection/enforce_admins
# ... merge ...
gh api -X POST   /repos/amdhd/vesselAI/branches/main/protection/enforce_admins
```

That is not a loophole — flipping `enforce_admins` is an audited act with a
before and an after, rather than a button that leaves the same trace as a normal
merge. It is simply a heavier lever than a solo repo needs while the QA path is
still young.

**Either way, read the verdict before overriding.** `infra` means nothing was
said about your code and an override may well be right. `blocking` means the
agent looked and the findings stand — that is the gate doing its job, and
clicking past it is choosing to repeat #130 knowingly rather than accidentally.

### Reproducing the protection

Send `checks` with `app_id`, never the flat `contexts` list — `contexts` resets
every entry's `app_id` to null, which lets any app satisfy the checks. That is a
silent weakening performed in the middle of a hardening change. Safest is to
build the payload from the live state rather than retyping it:

```bash
gh api /repos/amdhd/vesselAI/branches/main/protection --jq '{
  required_status_checks: {strict: .required_status_checks.strict,
    checks: (.required_status_checks.checks | map({context, app_id}))},
  enforce_admins: .enforce_admins.enabled,
  required_pull_request_reviews: {
    dismiss_stale_reviews: .required_pull_request_reviews.dismiss_stale_reviews,
    require_code_owner_reviews: .required_pull_request_reviews.require_code_owner_reviews,
    required_approving_review_count: .required_pull_request_reviews.required_approving_review_count},
  restrictions: null}' > protection.json
# edit protection.json, then:
gh api -X PUT /repos/amdhd/vesselAI/branches/main/protection --input protection.json
```

Order matters: apply protection only **after** the gate workflow is on `main`. A
required check does not exist for PRs whose merge ref lacks the workflow that
reports it, so requiring the context early strands open PRs at
"Expected — waiting for status to be reported".

## Evidence: does the contract context actually work?

The whole point of `.qa-contracts.json` is a claim that can be wrong, so it was
measured rather than asserted. The fixture was `test/qa-contracts-regression`
(since deleted): `main` with PR #130's seed defect re-planted — `/voyage/history`
sending `actual_fuel` where the client reads `actualFuel` — plus the findings
file that drove the #130 run.

### 1. The baseline — what #130 actually saw (free)

Replayed 2026-09-05 with the harness at `7e968d75`, the ref pinned at the time.
For F-001 (`TypeError on 'toFixed'`), the eight editable slots went to:

| # | File | |
|---|---|---|
| 1 | `VoyageHistory.tsx` | the crashing component |
| 2 | `backend/src/routes/voyage.ts` | the other side of the boundary |
| 3–7 | five sibling voyage modules | irrelevant |
| 8 | `voyageAgent.eval.test.ts` | a test file |

**131 files were withheld at `file cap (8)`**, including the three that carry the
contract — `types.ts`, `api.ts`, `utils.ts` — all scoring 6, just under the cut.

This refutes the obvious diagnosis. The model **had both sides of the boundary**,
with the wrong key visible in the route, and still guarded `ciiImpact`. Proximity
was never the problem.

### 2. After the manifest — what it is shown now (free)

Same branch, same findings, harness at `e2ddd24f` with the manifest present:

- `types.ts`, `api.ts`, `utils.ts` → present as **read-only contract context**
- editable set: **the same eight files**, nothing displaced
- only change is order — `voyage.ts` moves 2 → 1, because the manifest declares
  it `editable: true`
- contract context costs 1,511 bytes against 75,443 editable, ~2%

### 3. The live run — does it change the diagnosis? (~$0.09)

2026-09-06, one Bedrock call, `global.anthropic.claude-sonnet-4-6`, 27,397 in /
421 out. The agent proposed exactly one edit:

```diff
-        actual_fuel: v.actualFuel ?? v.plannedFuel,
+        actualFuel: v.actualFuel ?? v.plannedFuel,
```

> The field was named actual_fuel (snake_case) instead of actualFuel
> (camelCase), so voyage.actualFuel was undefined on the frontend, causing
> formatFuel to call toFixed on undefined.

That is the correct fix — identical to the human's `7da25c1` — and the correct
causal chain. It is also the fix #130 failed to find while looking at the same
route file.

Note the rationale cites **`formatFuel`**, which lives in `utils.ts`: a
read-only contract file, and one that was withheld at `file cap (8)` in the
#130 run. The added context is visibly load-bearing in the reasoning rather
than merely present.

### What this does not establish

**N=1.** One finding, one model call, one defect whose shape the manifest was
authored knowing. It shows the mechanism works end to end; it is not a measured
recall improvement, and `sources.py` warns in its own comments against treating
a single case as a measurement. Treat it as an existence proof.

## Things that will bite you

- **The job name is the contract.** The required-check context is the string
  `Reconcile gate`, which is the `gate` job's `name:`. Renaming the job detaches
  the protection rule from the job that satisfies it, and every PR then waits
  forever on a check that no longer exists.
- **No `paths:` filter on the gate, ever.** A required check must report on
  every PR to the protected branch. A path filter makes the workflow decline to
  start, which is not the same as passing — the PR stalls at
  "Expected — waiting for status to be reported". `ui-qa-agent.yml` keeps its
  path filter precisely because it is *not* required.
- **A new required check does not report retroactively.** Adding the context to
  branch protection leaves already-open PRs waiting until their next
  `synchronize`/`reopened` event. Nudge them — but remove the `agent-qa` label
  first if it is present, or the nudge also starts a paid advisory run.
- **The agent cannot switch the gate off.** `agent-fix.yml` stages only
  `git add -- frontend backend`. Because `pull_request` runs workflows from the
  merge ref, a branch that could edit `.github/` would be a branch that could
  disable the check standing between it and `main`. Widening that pathspec
  removes the guarantee.
- **Every push to an agent branch buys another QA run.** The gate fires on
  `synchronize`. That is correct — a new head deserves a new verdict — but it is
  not free, so hand-editing an agent branch has a price per push.
