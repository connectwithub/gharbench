/**
 * The Phase 6 matrix planner (`pnpm matrix`), Master Plan §8 Phase 6 / D5 /
 * I1 / I9.
 *
 * The instance is the atomic unit (I1): total agent-conversations =
 * instances x per-instance trials x contestants. The D5 run rule assigns
 * n=5 to every instance in the compliance-trap and Hinglish families and
 * n=3 everywhere else. This module is the planner and pre-flight gate - it
 * never spends money. Execution stays in the sweep runner:
 *
 *   pnpm matrix --contestant=... [--contestant=...] [--scenarios=public|all]
 *   pnpm sweep --contestant=... --buyer=... --trials-rule=d5 [--scenarios=...]
 *
 * The planner verifies the I9 authoring floors (>=20 instances per family,
 * >=30 for Hinglish), the 6.1 family-separation rule against the buyer AND
 * the judge panel, and prices the plan from the pilot-measured token
 * envelope. A missing price prints UNPRICED, never a guessed dollar figure
 * (ADR-0013).
 */

import { pathToFileURL } from 'node:url';

import type { ScenarioConfig } from '../engine/scenario.js';
import { JUDGE_PANEL } from '../judge/panel.js';
import { parseModelRef } from '../providers/registry.js';
import { estimateCostUsd } from '../telemetry/prices.js';
import { loadScenarioSet } from './scenarioSet.js';
import { selectScenarios, trialsFor, type SweepOptions } from './sweep.js';

/** Pilot-measured per-conversation token envelope (2026-08-20 sweeps). */
export const EST_TOKENS_PER_CONVERSATION = { input: 50_000, output: 4_000 };

export interface MatrixPlan {
  instances: number;
  conversationsPerContestant: number;
  totalConversations: number;
  blendedN: number;
  byFamily: Record<string, { instances: number; trials: number; conversations: number }>;
  floors: { name: string; met: boolean; detail: string }[];
  perContestant: { ref: string; conversations: number; estUsd: number | null }[];
  familyWarnings: string[];
}

export function planMatrix(
  scenarios: ScenarioConfig[],
  contestants: readonly string[],
  buyer?: string,
): MatrixPlan {
  const byFamily: MatrixPlan['byFamily'] = {};
  let conversationsPerContestant = 0;
  for (const s of scenarios) {
    const trials = trialsFor(s);
    const bucket = (byFamily[s.family] ??= { instances: 0, trials, conversations: 0 });
    bucket.instances += 1;
    bucket.conversations += trials;
    conversationsPerContestant += trials;
  }

  const floors: MatrixPlan['floors'] = [];
  for (const [family, b] of Object.entries(byFamily).sort()) {
    const min = family === 'hinglish_variant' ? 30 : 20;
    floors.push({
      name: `family ${family} >= ${min} instances (I9)`,
      met: b.instances >= min,
      detail: `${b.instances} instances x n=${b.trials}`,
    });
  }
  const total = scenarios.length;
  floors.push({
    name: 'instance count 150-250 (I1)',
    met: total >= 150 && total <= 250,
    detail: `${total} instances`,
  });

  // 6.1 family separation: no contestant may share a provider family with
  // the buyer or any panel judge (family-level self-preference bias).
  const familyWarnings: string[] = [];
  const judgeProviders = new Set(JUDGE_PANEL.map((j) => parseModelRef(j.ref).provider));
  const buyerProvider = buyer ? parseModelRef(buyer).provider : undefined;
  for (const c of contestants) {
    const provider = parseModelRef(c).provider;
    if (buyerProvider && provider === buyerProvider) {
      familyWarnings.push(`contestant ${c} shares provider "${provider}" with the buyer`);
    }
    if (judgeProviders.has(provider)) {
      familyWarnings.push(`contestant ${c} shares provider "${provider}" with a panel judge`);
    }
  }

  const perContestant = [...contestants].sort().map((ref) => {
    const { modelId } = parseModelRef(ref);
    const priced = estimateCostUsd(modelId, {
      inputTokens: EST_TOKENS_PER_CONVERSATION.input * conversationsPerContestant,
      outputTokens: EST_TOKENS_PER_CONVERSATION.output * conversationsPerContestant,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    return {
      ref,
      conversations: conversationsPerContestant,
      estUsd: priced.priced ? priced.usd : null,
    };
  });

  return {
    instances: total,
    conversationsPerContestant,
    totalConversations: conversationsPerContestant * contestants.length,
    blendedN: total > 0 ? conversationsPerContestant / total : 0,
    byFamily,
    floors,
    perContestant,
    familyWarnings,
  };
}

function main(): void {
  const contestants: string[] = [];
  let buyer: string | undefined;
  let scenarios: SweepOptions['scenarios'] = 'all';
  for (const arg of process.argv.slice(2)) {
    const [flag, value = ''] = arg.split(/=(.*)/s, 2);
    if (flag === '--contestant' && value) contestants.push(value);
    else if (flag === '--buyer') buyer = value;
    else if (flag === '--scenarios')
      scenarios = value === 'public' || value === 'all' ? value : value.split(',').filter(Boolean);
    else throw new Error(`unknown flag ${flag}`);
  }

  const set = loadScenarioSet({ includePrivate: true });
  const picked = selectScenarios(set, scenarios);
  if (!set.privatePoolLoaded) {
    console.warn('WARN private pool not present - the paper matrix needs it (30% of instances).');
  }
  const plan = planMatrix(picked, contestants, buyer);

  console.log(
    `matrix (D5): ${plan.instances} instances, blended n=${plan.blendedN.toFixed(2)}, ` +
      `${plan.conversationsPerContestant} conversations/contestant` +
      (contestants.length > 0
        ? `, ${contestants.length} contestant(s) -> ${plan.totalConversations} total`
        : ''),
  );
  for (const [family, b] of Object.entries(plan.byFamily).sort()) {
    console.log(`  ${family.padEnd(22)} ${String(b.instances).padStart(3)} x n=${b.trials} = ${b.conversations}`);
  }
  console.log('');
  for (const f of plan.floors) console.log(`${f.met ? 'MET  ' : 'UNMET'}  ${f.name}  (${f.detail})`);
  for (const w of plan.familyWarnings) console.log(`WARN family separation: ${w}`);
  for (const c of plan.perContestant) {
    console.log(
      `  ${c.ref}: ${c.conversations} conversations, ` +
        (c.estUsd !== null ? `~$${c.estUsd.toFixed(2)} list-price` : 'UNPRICED (verify before running)'),
    );
  }
  console.log(
    '\nexecute per contestant with:\n  pnpm sweep --contestant=<ref> --buyer=<ref> --trials-rule=d5 --scenarios=all',
  );
  if (plan.floors.some((f) => !f.met)) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
