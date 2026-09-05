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

There is deliberately **one** QA implementation. Two would drift, and the one
that drifted would be the one deciding whether an agent's fix may merge.

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

## Break-glass

> **Status: not yet armed.** `enforce_admins` is still `false` on `main`, so an
> admin can currently merge past a red gate using GitHub's own
> "merge without waiting for requirements" override. Once branch protection is
> updated, that override disappears and the procedure below becomes the only way
> through.

When `enforce_admins` is `true`, a red required check blocks **everyone**,
admins included. There is no per-merge override — that is the entire point of
the setting, and it is what makes a #130 repeat impossible.

That also means a genuine infrastructure failure can block a merge that nothing
is wrong with. The escape hatch is to lower the protection deliberately, merge,
and put it back:

```bash
gh api -X DELETE /repos/amdhd/vesselAI/branches/main/protection/enforce_admins
# ... merge ...
gh api -X POST   /repos/amdhd/vesselAI/branches/main/protection/enforce_admins
```

This is not a loophole. Flipping `enforce_admins` is an audited account-level
act with a before and an after, rather than a button on a PR that leaves the
same trace as an ordinary merge. The property #130 lacked — that bypassing the
verdict is *deliberate and visible* — is preserved; it just lives on a different
lever.

**Before reaching for it, check the verdict.** `infra` is a legitimate reason to
re-run and, if it persists, to break glass. `blocking` is not — that is the gate
doing its job.

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
