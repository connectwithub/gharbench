/**
 * The leaderboard assembler (`pnpm leaderboard --run=<runId> [--run=...]`) -
 * Phase 8's engine, runnable the moment a run has checks + judgments.
 *
 * Reads stored artifacts only (transcripts, checks.jsonl, judgments/,
 * costs.json) - no model is ever re-run (D7). Produces one JSON with the
 * macro-headline/micro-adjacent V1 table (D6), the V2-V6 variants and w_F
 * sweep with ROBUST vs non-separable pairwise orderings (D7), pass^k under
 * the D4 criterion (with 0.60/0.80 threshold sensitivity), per-family Wilson
 * + bootstrap CIs, the compliance hard-fail table per trap subtype, the
 * Hinglish gap, and $/conversation for the cost-frontier figure.
 *
 * Conversations that are hard-fail gated score composite 0 WITH no judgments
 * needed; non-gated conversations without judgments yet are counted as
 * `unjudged` coverage debt, never silently scored.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { CheckReport } from '../checks/types.js';
import { aggregateAnchor, aggregateBinary, anyFlag } from '../judge/panel.js';
import { qualityVerdictToPass } from '../judge/polarity.js';
import type { JudgeVerdict } from '../judge/schema.js';
import { bootstrapMeanCi, wilsonInterval } from '../metrics/ci.js';
import {
  V_WEIGHTS,
  blendSubScore,
  composite,
  d4Success,
  macroMean,
  microMean,
  robustOrdering,
  v5Keys,
  v6WeightsFor,
  weightsAtWf,
  WF_SWEEP_STEPS,
  type SubScores,
} from '../metrics/composite.js';
import { passPowerK, type TaskOutcome } from '../metrics/passk.js';
import { TRANSCRIPT_FILENAME, readTranscripts } from '../logging/transcript.js';
import { loadJudgments } from './judgeAgreement.js';
import { DIMENSIONS, readCheckReports, runCaseId, type StoredJudgment } from './judgeRun.js';
import { REPO_ROOT, loadScenarioSet } from './scenarioSet.js';
import type { JudgeDimension } from './judgeItems.js';

interface DimRaw {
  fraction: number | null;
  anchor: number | null;
}

/** One scored conversation, or the reason it could not be scored. */
export interface ScoredConversation {
  runId: string;
  conversationId: string;
  contestantId: string;
  scenarioId: string;
  family: string;
  language: string;
  activeTrapIds: string[];
  status: 'scored' | 'gated' | 'unjudged';
  sub: SubScores | null;
  /** Unblended dimension inputs, kept for the D1 0.67/0.33 ablation. */
  dims: { fact: DimRaw; sales: DimRaw; qual: DimRaw } | null;
  hardFailSources: string[];
}

/** Re-blend a conversation's sub-scores at a different binary weight (D1). */
export function reblend(c: ScoredConversation, binaryWeight: number): SubScores | null {
  if (!c.sub) return null;
  if (!c.dims) return c.sub; // gated: composite is 0 under any blend
  return {
    hardFail: c.sub.hardFail,
    prog: c.sub.prog,
    fact: blendSubScore(c.dims.fact.fraction, c.dims.fact.anchor, binaryWeight) ?? 0,
    sales: blendSubScore(c.dims.sales.fraction, c.dims.sales.anchor, binaryWeight) ?? 0,
    qual: blendSubScore(c.dims.qual.fraction, c.dims.qual.anchor, binaryWeight) ?? 0,
  };
}

/** Aggregate the 3-judge panel for one conversation x dimension. */
export function panelDimension(
  verdicts: readonly JudgeVerdict[],
  dimension: JudgeDimension,
  applicable: readonly string[],
): { fraction: number | null; anchor: number | null; flagged: boolean } {
  // Binary fraction: 2-of-3 majority per item; unscored items drop out of
  // numerator AND denominator (never counted as free passes).
  let met = 0;
  let scored = 0;
  let flagged = false;
  for (const itemId of applicable) {
    const votes = verdicts
      .map((v) => v.items.find((i) => i.id === itemId)?.verdict)
      .filter((x): x is NonNullable<typeof x> => x !== undefined);
    if (dimension === 'compliance') {
      const cpVotes = votes.filter((x): x is 'VIOLATION' | 'OK' => x === 'VIOLATION' || x === 'OK');
      if (cpVotes.length > 0 && anyFlag(cpVotes)) flagged = true;
      continue;
    }
    const qVotes = votes.filter((x): x is 'met' | 'not_met' => x === 'met' || x === 'not_met');
    const majority = aggregateBinary(qVotes);
    if (majority === 'unscored') continue;
    scored += 1;
    if (qualityVerdictToPass(majority)) met += 1;
  }

  // Anchors: median per anchor id; sales averages its two medians (D1).
  const anchorIds = new Set<string>();
  for (const v of verdicts) for (const a of v.anchors) anchorIds.add(a.id);
  const medians: number[] = [];
  for (const id of [...anchorIds].sort()) {
    const scores = verdicts
      .map((v) => v.anchors.find((a) => a.id === id)?.score)
      .filter((s): s is number => s !== undefined);
    const median = aggregateAnchor(scores);
    if (median !== null) medians.push(median);
  }
  const anchor = medians.length > 0 ? medians.reduce((a, b) => a + b, 0) / medians.length : null;

  return { fraction: scored > 0 ? met / scored : null, anchor, flagged };
}

export function scoreRun(runId: string): ScoredConversation[] {
  const runDir = join(REPO_ROOT, 'runs', runId);
  const transcriptPath = join(runDir, TRANSCRIPT_FILENAME);
  if (!existsSync(transcriptPath)) throw new Error(`No ${TRANSCRIPT_FILENAME} in runs/${runId}`);
  const checks = readCheckReports(runDir);
  const judgments = loadJudgments(join(runDir, 'judgments'));
  const byCase = new Map<string, StoredJudgment[]>();
  for (const j of judgments) {
    const bucket = byCase.get(j.caseId) ?? [];
    bucket.push(j);
    byCase.set(j.caseId, bucket);
  }

  const set = loadScenarioSet({ includePrivate: true });
  const scenarioById = new Map(set.scenarios.map((s) => [s.scenarioId, s]));

  const out: ScoredConversation[] = [];
  for (const record of readTranscripts(transcriptPath)) {
    if (record.terminationReason.kind === 'error') continue;
    const scenario = scenarioById.get(record.scenarioId);
    if (!scenario) continue;
    const report: CheckReport | undefined = checks.get(record.conversationId);

    const base = {
      runId,
      conversationId: record.conversationId,
      contestantId: record.contestantId,
      scenarioId: record.scenarioId,
      family: scenario.family,
      language: scenario.language,
      activeTrapIds: scenario.activeTrapIds,
    };

    // ProgScore (D2): declared applicable NON-compliance checks only.
    const nonC = report?.results.filter((r) => !r.cTagged) ?? [];
    const prog = nonC.length > 0 ? nonC.filter((r) => r.passed).length / nonC.length : 1;
    const l1HardFail = report?.gatesJudging ?? false;

    if (l1HardFail) {
      out.push({
        ...base,
        status: 'gated',
        sub: { hardFail: true, prog, fact: 0, sales: 0, qual: 0 },
        dims: null,
        hardFailSources: report?.hardFails ?? [],
      });
      continue;
    }

    const caseId = runCaseId(record.contestantId, record.conversationId);
    const caseJudgments = byCase.get(caseId) ?? [];
    const verdictsFor = (dimension: JudgeDimension): JudgeVerdict[] =>
      caseJudgments
        .filter((j) => j.dimension === dimension && j.outcome.kind === 'verdict')
        .map((j) => (j.outcome as { kind: 'verdict'; verdict: JudgeVerdict }).verdict);

    if (DIMENSIONS.some((d) => verdictsFor(d).length === 0)) {
      out.push({ ...base, status: 'unjudged', sub: null, dims: null, hardFailSources: [] });
      continue;
    }

    const fact = panelDimension(verdictsFor('factuality'), 'factuality', scenario.judgeApplicability.factuality);
    const sales = panelDimension(
      verdictsFor('salesEffectiveness'),
      'salesEffectiveness',
      scenario.judgeApplicability.salesEffectiveness,
    );
    const qual = panelDimension(
      verdictsFor('conversationQuality'),
      'conversationQuality',
      scenario.judgeApplicability.conversationQuality,
    );
    const compliance = panelDimension(
      verdictsFor('compliance'),
      'compliance',
      scenario.judgeApplicability.compliance,
    );

    const sub: SubScores = {
      hardFail: compliance.flagged,
      prog,
      fact: blendSubScore(fact.fraction, fact.anchor) ?? 0,
      sales: blendSubScore(sales.fraction, sales.anchor) ?? 0,
      qual: blendSubScore(qual.fraction, qual.anchor) ?? 0,
    };
    out.push({
      ...base,
      status: 'scored',
      sub,
      dims: {
        fact: { fraction: fact.fraction, anchor: fact.anchor },
        sales: { fraction: sales.fraction, anchor: sales.anchor },
        qual: { fraction: qual.fraction, anchor: qual.anchor },
      },
      hardFailSources: compliance.flagged ? ['CP-panel-any-flag'] : [],
    });
  }
  return out;
}

// ------------------------------------------------------------ assembly -----

interface FamilyRow {
  conversations: number;
  meanV1: number | null;
  bootstrapCi: { lower: number; upper: number } | null;
  successRate: number | null;
  wilson: { lower: number; upper: number } | null;
  passK: Record<string, number | null>;
}

export interface LeaderboardEntry {
  contestantId: string;
  conversations: number;
  gated: number;
  unjudged: number;
  hardFailRate: number | null;
  macroV1: number | null;
  microV1: number | null;
  variants: Record<string, number | null>;
  blendAblationV1: number | null;
  wfSweep: Record<string, number | null>;
  v5Keys: number[];
  perFamily: Record<string, FamilyRow>;
  hinglishGap: { english: number | null; hinglish: number | null; delta: number | null };
  costPerConversation: number | null;
  d4Sensitivity: Record<string, number | null>;
}

export interface Leaderboard {
  generatedAt: string;
  runIds: string[];
  entries: LeaderboardEntry[];
  robustPairs: { a: string; b: string; verdict: 'a' | 'b' | 'non-separable' }[];
  hardFailByTrap: Record<string, Record<string, number>>;
}

function readCostPerConversation(runIds: readonly string[]): Map<string, { usd: number; n: number }> {
  const out = new Map<string, { usd: number; n: number }>();
  for (const runId of runIds) {
    const path = join(REPO_ROOT, 'runs', runId, 'costs.json');
    if (!existsSync(path)) continue;
    const costs = JSON.parse(readFileSync(path, 'utf8')) as {
      perConversation?: { contestant: string; summary: { totalUsd: number } }[];
    };
    for (const c of costs.perConversation ?? []) {
      const bucket = out.get(c.contestant) ?? { usd: 0, n: 0 };
      bucket.usd += c.summary.totalUsd;
      bucket.n += 1;
      out.set(c.contestant, bucket);
    }
  }
  return out;
}

export function buildLeaderboard(runIds: readonly string[]): Leaderboard {
  const scored = runIds.flatMap((r) => scoreRun(r));
  const byContestant = new Map<string, ScoredConversation[]>();
  for (const c of scored) {
    const bucket = byContestant.get(c.contestantId) ?? [];
    bucket.push(c);
    byContestant.set(c.contestantId, bucket);
  }
  const costByRef = readCostPerConversation(runIds);

  const subsByFamilyOf = (convs: readonly ScoredConversation[]): Map<string, SubScores[]> => {
    const m = new Map<string, SubScores[]>();
    for (const c of convs) {
      if (!c.sub) continue;
      const bucket = m.get(c.family) ?? [];
      bucket.push(c.sub);
      m.set(c.family, bucket);
    }
    return m;
  };

  const entries: LeaderboardEntry[] = [...byContestant.entries()].sort().map(([contestantId, convs]) => {
    const usable = convs.filter((c) => c.sub !== null);
    const byFamily = subsByFamilyOf(convs);
    const macroOf = (w: Parameters<typeof composite>[1]): number | null =>
      macroMean(new Map([...byFamily.entries()].map(([f, subs]) => [f, subs.map((s) => composite(s, w))])));

    // pass^k per family under D4, macro-averaged (D6); pass^4/5 = n=5 subset.
    const perFamily: Record<string, FamilyRow> = {};
    for (const [family, subs] of [...byFamily.entries()].sort()) {
      const familyConvs = usable.filter((c) => c.family === family);
      const byInstance = new Map<string, { successes: number; trials: number }>();
      for (const c of familyConvs) {
        const inst = byInstance.get(c.scenarioId) ?? { successes: 0, trials: 0 };
        inst.trials += 1;
        if (c.sub && d4Success(c.sub)) inst.successes += 1;
        byInstance.set(c.scenarioId, inst);
      }
      const outcomes: TaskOutcome[] = [...byInstance.entries()]
        .sort()
        .map(([taskId, o]) => ({ taskId, ...o }));
      const minTrials = Math.min(...outcomes.map((o) => o.trials), Infinity);
      const passK: Record<string, number | null> = {};
      for (const k of [1, 3, 4, 5]) {
        passK[`pass^${k}`] =
          outcomes.length > 0 && minTrials >= k ? passPowerK(outcomes, k).value : null;
      }
      const successes = familyConvs.filter((c) => c.sub && d4Success(c.sub)).length;
      const v1Values = subs.map((s) => composite(s, V_WEIGHTS.V1));
      perFamily[family] = {
        conversations: familyConvs.length,
        meanV1: microMean(v1Values),
        bootstrapCi: bootstrapMeanCi(v1Values),
        successRate: familyConvs.length > 0 ? successes / familyConvs.length : null,
        wilson: familyConvs.length > 0 ? wilsonInterval(successes, familyConvs.length) : null,
        passK,
      };
    }

    // V6: per-family weights, then macro.
    const v6 = macroMean(
      new Map(
        [...byFamily.entries()].map(([f, subs]) => [
          f,
          subs.map((s) => composite(s, v6WeightsFor(f))),
        ]),
      ),
    );

    const langMean = (language: string): number | null =>
      microMean(
        usable
          .filter((c) => c.language === language)
          .map((c) => composite(c.sub as SubScores, V_WEIGHTS.V1)),
      );
    const english = langMean('english');
    const hinglish = langMean('hinglish');

    const d4At = (threshold: number): number | null => {
      const withSub = usable.filter((c) => c.sub);
      if (withSub.length === 0) return null;
      return withSub.filter((c) => d4Success(c.sub as SubScores, threshold)).length / withSub.length;
    };

    // Transcript ids look like "contestant:<ref>"; costs.json keys the bare ref.
    const cost = costByRef.get(contestantId) ?? costByRef.get(contestantId.replace(/^contestant:/, ''));
    return {
      contestantId,
      conversations: convs.length,
      gated: convs.filter((c) => c.status === 'gated').length,
      unjudged: convs.filter((c) => c.status === 'unjudged').length,
      hardFailRate:
        usable.length > 0 ? usable.filter((c) => c.sub?.hardFail).length / usable.length : null,
      macroV1: macroOf(V_WEIGHTS.V1),
      microV1: microMean(usable.map((c) => composite(c.sub as SubScores, V_WEIGHTS.V1))),
      variants: {
        V2: macroOf(V_WEIGHTS.V2),
        V3: macroOf(V_WEIGHTS.V3),
        V4: macroOf(V_WEIGHTS.V4),
        V6: v6,
      },
      // D1 ablation: V1 recomputed with the 0.67/0.33 binary-heavy blend.
      blendAblationV1: macroMean(
        (() => {
          const m = new Map<string, number[]>();
          for (const c of usable) {
            const sub = reblend(c, 0.67);
            if (!sub) continue;
            const bucket = m.get(c.family) ?? [];
            bucket.push(composite(sub, V_WEIGHTS.V1));
            m.set(c.family, bucket);
          }
          return m;
        })(),
      ),
      wfSweep: Object.fromEntries(
        WF_SWEEP_STEPS.map((wf) => [wf.toFixed(2), macroOf(weightsAtWf(wf))]),
      ),
      v5Keys: v5Keys(byFamily),
      perFamily,
      hinglishGap: {
        english,
        hinglish,
        delta: english !== null && hinglish !== null ? english - hinglish : null,
      },
      costPerConversation: cost && cost.n > 0 ? cost.usd / cost.n : null,
      d4Sensitivity: { '0.60': d4At(0.6), '0.70': d4At(0.7), '0.80': d4At(0.8) },
    };
  });

  // D7 pairwise robustness over every contestant pair.
  const robustPairs: Leaderboard['robustPairs'] = [];
  const ids = [...byContestant.keys()].sort();
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i] as string;
      const b = ids[j] as string;
      robustPairs.push({
        a,
        b,
        verdict: robustOrdering(
          subsByFamilyOf(byContestant.get(a) ?? []),
          subsByFamilyOf(byContestant.get(b) ?? []),
        ),
      });
    }
  }

  // Compliance hard-fail table per trap subtype.
  const hardFailByTrap: Leaderboard['hardFailByTrap'] = {};
  for (const c of scored) {
    if (!c.sub?.hardFail) continue;
    for (const trap of c.activeTrapIds.length > 0 ? c.activeTrapIds : ['(no-trap)']) {
      const row = (hardFailByTrap[trap] ??= {});
      row[c.contestantId] = (row[c.contestantId] ?? 0) + 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    runIds: [...runIds],
    entries,
    robustPairs,
    hardFailByTrap,
  };
}

function fmt(n: number | null | undefined): string {
  return n === null || n === undefined ? '   -  ' : n.toFixed(4);
}

function main(): void {
  const runIds = process.argv.filter((a) => a.startsWith('--run=')).map((a) => a.slice(6));
  if (runIds.length === 0) throw new Error('Pass at least one --run=<runId>.');
  const board = buildLeaderboard(runIds);

  const outDir = join(REPO_ROOT, 'runs', 'leaderboard');
  mkdirSync(outDir, { recursive: true });
  const stamp = board.generatedAt.replace(/[-:]/g, '').replace(/\..*$/, 'Z');
  const outPath = join(outDir, `${stamp}-leaderboard.json`);
  writeFileSync(outPath, JSON.stringify(board, null, 2) + '\n');

  console.log('=== leaderboard (V1 macro headline / micro adjacent - D6) ===');
  for (const e of board.entries) {
    console.log(
      `${e.contestantId.padEnd(30)} macro=${fmt(e.macroV1)} micro=${fmt(e.microV1)} ` +
        `hard-fail=${fmt(e.hardFailRate)} $${e.costPerConversation?.toFixed(4) ?? '-'}/conv ` +
        `(${e.conversations} convs, ${e.gated} gated, ${e.unjudged} unjudged)`,
    );
  }
  const robust = board.robustPairs.filter((p) => p.verdict !== 'non-separable').length;
  console.log(
    `pairwise orderings: ${robust} ROBUST, ${board.robustPairs.length - robust} non-separable (D7)`,
  );
  const unjudged = board.entries.reduce((a, e) => a + e.unjudged, 0);
  if (unjudged > 0) {
    console.log(`COVERAGE DEBT: ${unjudged} non-gated conversation(s) lack judgments - run pnpm judge:run first.`);
  }
  console.log(`written: ${outPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
