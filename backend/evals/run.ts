import 'dotenv/config';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { runVoyageAgent, AgentPlan } from '../src/services/voyageAgent';
import { EVAL_VESSEL, SCENARIOS, SPEED_PAIR } from './scenarios';
import { gradePlan, extractRecommendedSpeed, GradeResult } from './graders';

// Opt-in behavioural eval: runs the REAL agent against each scenario, grades the
// resulting plan, and writes a scorecard to evals/report.md. This makes live API
// calls (a few cents), so it is NOT part of `npm test` — run it deliberately:
//
//   RUN_AGENT_EVALS=1 npm run eval:agent
//
// The guard below refuses to spend unless RUN_AGENT_EVALS=1 is set, so a stray
// `ts-node evals/run.ts` can't quietly burn API budget.

interface ScenarioResult {
  id: string;
  description: string;
  grades: GradeResult[];
  recommendedSpeed: number | null;
  error?: string;
}

async function main() {
  if (process.env.RUN_AGENT_EVALS !== '1') {
    console.error(
      'Refusing to run: this suite makes live (paid) Anthropic calls.\n' +
        'Set RUN_AGENT_EVALS=1 to proceed, e.g.  RUN_AGENT_EVALS=1 npm run eval:agent'
    );
    process.exit(2);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set — nothing to run against.');
    process.exit(2);
  }

  const results: ScenarioResult[] = [];
  const planById = new Map<string, AgentPlan>();

  for (const scenario of SCENARIOS) {
    process.stdout.write(`▶ ${scenario.id} … `);
    try {
      const plan = await runVoyageAgent(EVAL_VESSEL, scenario.params);
      planById.set(scenario.id, plan);
      const grades = gradePlan(plan, scenario);
      results.push({
        id: scenario.id,
        description: scenario.description,
        grades,
        recommendedSpeed: extractRecommendedSpeed(plan),
      });
      const passed = grades.filter((g) => g.pass).length;
      console.log(`${passed}/${grades.length} checks passed`);
    } catch (err) {
      console.log('ERROR');
      results.push({
        id: scenario.id,
        description: scenario.description,
        grades: [],
        recommendedSpeed: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Cross-scenario invariant: an economic profile should not out-run a fast one.
  const eco = planById.get(SPEED_PAIR.economic);
  const fast = planById.get(SPEED_PAIR.fast);
  let invariant: GradeResult | null = null;
  if (eco && fast) {
    const ecoSpeed = extractRecommendedSpeed(eco);
    const fastSpeed = extractRecommendedSpeed(fast);
    if (ecoSpeed != null && fastSpeed != null) {
      invariant = {
        name: 'economic profile recommends ≤ fast profile speed',
        pass: ecoSpeed <= fastSpeed,
        detail: `economic=${ecoSpeed}kn fast=${fastSpeed}kn`,
      };
    }
  }

  const report = renderReport(results, invariant);
  const outPath = join(__dirname, 'report.md');
  writeFileSync(outPath, report);
  console.log(`\nWrote ${outPath}`);
  console.log(summaryLine(results, invariant));

  // Non-zero exit if anything failed, so CI/local use can gate on it if desired.
  const { failed } = tally(results, invariant);
  process.exit(failed > 0 ? 1 : 0);
}

function tally(results: ScenarioResult[], invariant: GradeResult | null) {
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    if (r.error) failed += 1;
    for (const g of r.grades) (g.pass ? (passed += 1) : (failed += 1));
  }
  if (invariant) invariant.pass ? (passed += 1) : (failed += 1);
  return { passed, failed };
}

function summaryLine(results: ScenarioResult[], invariant: GradeResult | null): string {
  const { passed, failed } = tally(results, invariant);
  return `Scorecard: ${passed}/${passed + failed} checks passed.`;
}

function renderReport(results: ScenarioResult[], invariant: GradeResult | null): string {
  const lines: string[] = [];
  lines.push('# Voyage-agent behavioural eval report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Model runs: ${results.length} scenarios. ${summaryLine(results, invariant)}`);
  lines.push('');
  for (const r of results) {
    lines.push(`## ${r.id}`);
    lines.push(`_${r.description}_`);
    lines.push('');
    if (r.error) {
      lines.push(`- ❌ **errored:** ${r.error}`);
    } else {
      for (const g of r.grades) {
        lines.push(`- ${g.pass ? '✅' : '❌'} ${g.name} — \`${g.detail}\``);
      }
      if (r.recommendedSpeed != null) lines.push(`- ℹ️ recommended speed: ${r.recommendedSpeed} kn`);
    }
    lines.push('');
  }
  if (invariant) {
    lines.push('## cross-scenario invariant');
    lines.push(`- ${invariant.pass ? '✅' : '❌'} ${invariant.name} — \`${invariant.detail}\``);
    lines.push('');
  }
  return lines.join('\n');
}

main().catch((err) => {
  console.error('Eval runner crashed:', err);
  process.exit(1);
});
