/**
 * The calibration labeler's blindness contract (ADR-0022).
 *
 * Case ids encode provenance (cal_syn_pass_*, cal_adv_*, contestant names in
 * cal_real_*), so the rater-facing API speaks only positional aliases and the
 * served case object carries no identity at all. CP items are violation-worded
 * (see src/judge/polarity.ts): the UI must present them as
 * violation/no-violation, never as a green "Met".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buyerLeakMarker } from '../src/run/calibrationBuild.js';
import { calibrationCaseSchema, calibrationLabelSchema } from '../src/run/calibrationCase.js';
import {
  aliasCaseIds,
  buildLabel,
  buildReference,
  buildServedList,
  parseOnlyPositions,
  redactCase,
} from '../src/run/calibrationLabelServer.js';
import { loadJudgeItems } from '../src/run/judgeItems.js';
import { loadSourceDocuments } from '../src/run/judgeRun.js';
import { REPO_ROOT } from '../src/run/scenarioSet.js';

const CASE = calibrationCaseSchema.parse({
  caseId: 'cal_syn_pass_example',
  source: 'synthetic',
  band: 'known_pass',
  family: 'cold_inquiry',
  language: 'english',
  endedBy: 'buyer',
  provenance: {
    runId: 'r',
    conversationId: 'c',
    scenarioId: 's',
    contestantRef: 'anthropic/claude-x',
  },
  judgeApplicability: {
    factuality: ['F1'],
    compliance: ['CP1'],
    salesEffectiveness: [],
    conversationQuality: [],
  },
  messages: [
    { role: 'buyer', text: 'hi' },
    { role: 'agent', text: 'hello' },
  ],
});

describe('calibration labeler blindness', () => {
  it('serves no case identity, band, source or provenance to the rater', () => {
    const served = redactCase(CASE);
    expect(Object.keys(served).sort()).toEqual([
      'endedBy',
      'judgeApplicability',
      'language',
      'messages',
    ]);
    // ADR-0029: the closing tool IS served when present - it is observable
    // conversation data, not provenance.
    const agentEnded = redactCase({
      ...CASE,
      endedBy: 'agent',
      endedByTool: 'escalate_to_human',
    });
    expect(agentEnded['endedByTool']).toBe('escalate_to_human');
  });

  it('aliases are positional over the given order, padded, and bijective', () => {
    const { toAlias, toId } = aliasCaseIds(['cal_b', 'cal_a', 'cal_c']);
    expect(toAlias.get('cal_b')).toBe('c001');
    expect(toAlias.get('cal_a')).toBe('c002');
    expect(toAlias.get('cal_c')).toBe('c003');
    expect(toId.size).toBe(3);
    for (const [id, alias] of toAlias) expect(toId.get(alias)).toBe(id);
  });

  it('the ground-truth reference serves the judge-identical document set plus the gold DB', () => {
    const ref = buildReference();
    // Byte-parity with what buildJudgeSystem embeds as SOURCE DOCUMENTS: the
    // human answer key must never be less informed than the judges it grades.
    const joined = ref.documents.map((d) => `--- ${d.file} ---\n${d.text}`).join('\n\n');
    expect(joined).toBe(loadSourceDocuments());
    expect(ref.documents.length).toBeGreaterThan(0);
    expect(ref.db.units).toHaveLength(32);
    expect(ref.db.siteVisitSlots.length).toBeGreaterThan(0);
    expect(ref.db.agentPolicy).toBeDefined();
    // ADR-0029: "did the agent even have such a facility?" is ground truth -
    // the complete tool roster and sendable-asset list are on screen.
    expect(ref.tools).toHaveLength(6);
    expect(ref.tools.filter((t) => t.endsChat)).toHaveLength(2);
    expect(ref.db.assets.length).toBeGreaterThan(0);
  });

  it('the UI states the goal and presents CP items in violation polarity', () => {
    const html = readFileSync(join(REPO_ROOT, 'src', 'run', 'calibrationLabel.html'), 'utf8');
    expect(html).toContain('You are grading the agent');
    expect(html).toContain('Violation — happened');
    expect(html).toContain('No violation');
    // The stored value stays 'met' = "the violation happened"; the flip to
    // pass/fail lives in src/judge/polarity.ts and nowhere else.
    expect(html).toContain("id.startsWith('CP')");
    // ADR-0026: shared interpretation notes reach the rater from the same
    // rubric file the judge prompts render.
    expect(html).toContain('interpretationNotes');
    // ADR-0027: the ended-by chip - an agent tool-close has no text bubble.
    expect(html).toContain('ended by: agent (tool action)');
    // ADR-0029: the chip names WHICH close, and the panel carries the
    // complete tool roster + sendable-asset list.
    expect(html).toContain('ended by: agent — escalated to human');
    expect(html).toContain('ended by: agent — logged & closed the lead');
    expect(html).toContain('The agent’s tools — the COMPLETE set');
    expect(html).toContain('Sendable assets — the COMPLETE list');
    // Search jump: clicking a hit opens the tab, scrolls to and flashes the row.
    expect(html).toContain('flashBg');
    // 2026-08-27 display upgrades: per-level anchor examples (rater-only, see
    // protocol-notes), sortable columns, tower×BHK summary, global search.
    expect(html).toContain('a.examples');
    expect(html).toContain('Worked examples');
    expect(html).toContain('buildSearchIndex');
    expect(html).toContain("['summary', 'Summary']");
    expect(html).toContain('SortTable');
  });
});

describe('--only re-check filter', () => {
  const ORDER = ['cal_e', 'cal_b', 'cal_a', 'cal_d', 'cal_c'];

  it('serves only the named positions, ascending, keeping their true numbers', () => {
    const { toAlias } = aliasCaseIds(ORDER);
    const view = buildServedList(ORDER, '3,1');
    // Ascending, deduped, and the positions are the UNFILTERED ones.
    expect(view.positions).toEqual([1, 3]);
    expect(view.filtered).toBe(true);
    expect(view.total).toBe(5);
    // The alias map is computed over the FULL rater set, so a filtered sitting
    // and a full sitting address the same case by the same handle.
    expect(view.ids).toEqual(['cal_e', 'cal_a']);
    expect(view.aliases).toEqual([toAlias.get('cal_e'), toAlias.get('cal_a')]);
    expect(buildServedList(ORDER, '3,1,3, 1 ').aliases).toEqual(view.aliases);
  });

  it('a position outside the filter is not served, so the fetch path 404s it', () => {
    // The /api/case and /api/label guards key on exactly this set.
    const served = new Set(buildServedList(ORDER, '3,1').aliases);
    expect(served.has('c002')).toBe(false);
    expect(served.has('c004')).toBe(false);
    expect(served.has('c001')).toBe(true);
    expect(served.has('c003')).toBe(true);
  });

  it('rejects a non-integer, an out-of-range position and an empty list at startup', () => {
    expect(() => parseOnlyPositions('2,x', 5)).toThrow(/not a positive integer/);
    expect(() => parseOnlyPositions('2.5', 5)).toThrow(/not a positive integer/);
    expect(() => parseOnlyPositions('-1', 5)).toThrow(/not a positive integer/);
    expect(() => parseOnlyPositions('0', 5)).toThrow(/out of range/);
    expect(() => parseOnlyPositions('6', 5)).toThrow(/out of range/);
    expect(() => parseOnlyPositions(' , ', 5)).toThrow(/at least one position/);
  });

  it('no flag serves the full aliased order, unchanged', () => {
    const { toAlias } = aliasCaseIds(ORDER);
    const view = buildServedList(ORDER);
    expect(view.aliases).toEqual(ORDER.map((id) => toAlias.get(id)));
    expect(view.positions).toEqual([1, 2, 3, 4, 5]);
    expect(view.ids).toEqual([...ORDER]);
    expect(view.filtered).toBe(false);
    expect(view.total).toBe(5);
  });

  it('the UI numbers the sidebar from the served positions, not its array index', () => {
    const html = readFileSync(join(REPO_ROOT, 'src', 'run', 'calibrationLabel.html'), 'utf8');
    expect(html).toContain('`case ${positions[j]}');
    expect(html).toContain('`case ${positions[idx]} of ${listInfo.total}`');
    expect(html).toContain('Re-check mode: ${order.length} of ${listInfo.total} positions');
    // Progress and navigation stay within the SERVED list.
    expect(html).toContain('${labeled.size}/${order.length} labeled');
  });
});

describe('saved labels record the rubric they answer', () => {
  it('stamps itemsVersion and still drops answers the case never asked', () => {
    const parsed = buildLabel({
      caseId: CASE.caseId,
      rater: 'self',
      itemsVersion: loadJudgeItems().version,
      judgeApplicability: CASE.judgeApplicability,
      posted: { binary: { F1: 'met', CP1: 'not_met', SE3: 'met' }, anchors: { FA1: 2 } },
      labeledAt: '2026-09-21T00:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.itemsVersion).toBe(loadJudgeItems().version);
    // SE3 was never asked of this case; a stale UI key must not be stored.
    expect(Object.keys(parsed.data.binary).sort()).toEqual(['CP1', 'F1']);
  });

  it('accepts a label saved before the field existed', () => {
    const parsed = calibrationLabelSchema.safeParse({
      caseId: CASE.caseId,
      rater: 'self',
      labeledAt: '2026-09-20T00:00:00.000Z',
      binary: { F1: 'met' },
      anchors: { FA1: 2 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.itemsVersion).toBeUndefined();
  });
});

describe('buyer scaffolding-leak screen (ADR-0028)', () => {
  it('flags reminder blocks and card vocabulary in buyer messages only', () => {
    expect(
      buyerLeakMarker([
        {
          role: 'buyer',
          text: 'thik hai\n\n<simulation-reminder>\n- Hidden budget ceiling: 75L\n</simulation-reminder>',
        },
      ]),
    ).not.toBeNull();
    expect(
      buyerLeakMarker([{ role: 'buyer', text: 'my walk-away trigger is unclear pricing' }]),
    ).not.toBeNull();
    expect(
      buyerLeakMarker([{ role: 'buyer', text: 'I will stop here ###STOP###' }]),
    ).not.toBeNull();
    // Only BUYER surfaces are screened; and ordinary budget talk is not a leak.
    expect(buyerLeakMarker([{ role: 'agent', text: '<simulation-reminder>' }])).toBeNull();
    expect(
      buyerLeakMarker([{ role: 'buyer', text: 'budget 75 lakh max hai, usse zyada nahi' }]),
    ).toBeNull();
  });
});
