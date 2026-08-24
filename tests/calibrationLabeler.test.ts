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

import { calibrationCaseSchema } from '../src/run/calibrationCase.js';
import { aliasCaseIds, buildReference, redactCase } from '../src/run/calibrationLabelServer.js';
import { loadSourceDocuments } from '../src/run/judgeRun.js';
import { REPO_ROOT } from '../src/run/scenarioSet.js';

const CASE = calibrationCaseSchema.parse({
  caseId: 'cal_syn_pass_example',
  source: 'synthetic',
  band: 'known_pass',
  family: 'cold_inquiry',
  language: 'english',
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
    expect(Object.keys(served).sort()).toEqual(['judgeApplicability', 'language', 'messages']);
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
  });

  it('the UI states the goal and presents CP items in violation polarity', () => {
    const html = readFileSync(join(REPO_ROOT, 'src', 'run', 'calibrationLabel.html'), 'utf8');
    expect(html).toContain('You are grading the agent');
    expect(html).toContain('Violation — happened');
    expect(html).toContain('No violation');
    // The stored value stays 'met' = "the violation happened"; the flip to
    // pass/fail lives in src/judge/polarity.ts and nowhere else.
    expect(html).toContain("id.startsWith('CP')");
  });
});
