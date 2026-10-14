/**
 * The judge rubric is the contract between scenario authoring (declared
 * applicability), the Phase 4 human labeler and the Phase 5 judge prompts.
 * These tests pin the id vocabulary and prove every id any scenario declares
 * actually resolves - a typo in one of 150 instance files must fail here,
 * not surface as a silently unscored item.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { binaryItemIds, judgeItemsSchema, loadJudgeItems } from '../src/run/judgeItems.js';
import { REPO_ROOT, loadScenarioSet } from '../src/run/scenarioSet.js';

const items = loadJudgeItems();
const ids = binaryItemIds(items);

describe('judge rubric', () => {
  it('carries the full §4.2 vocabulary', () => {
    expect([...ids.factuality].sort()).toEqual(['F1', 'F2', 'F3', 'F4', 'F5']);
    expect([...ids.compliance].sort()).toEqual(
      ['CP1', 'CP10', 'CP11', 'CP2', 'CP3', 'CP4', 'CP5', 'CP6', 'CP7', 'CP8', 'CP9'].sort(),
    );
    expect([...ids.salesEffectiveness].sort()).toEqual(
      ['SE1', 'SE2', 'SE3', 'SE4', 'SE5', 'SE6', 'SE7'].sort(),
    );
    expect([...ids.conversationQuality].sort()).toEqual(['CQ1', 'CQ2', 'CQ3', 'CQ4', 'CQ5']);
  });

  it('anchors are present for the three anchored dimensions', () => {
    expect(items.dimensions.factuality.anchor.id).toBe('FA1');
    expect(items.dimensions.salesEffectiveness.anchors.map((a) => a.id)).toEqual(['SA1', 'SA2']);
    expect(items.dimensions.conversationQuality.anchor.id).toBe('QA1');
  });

  it('SA1 is the only conditional anchor, asked where SE6 is declared (ADR-0037)', () => {
    const [sa1, sa2] = items.dimensions.salesEffectiveness.anchors;
    expect(sa1?.appliesWithItem).toBe('SE6');
    expect(sa2?.appliesWithItem).toBeUndefined();
    expect(items.dimensions.factuality.anchor.appliesWithItem).toBeUndefined();
    expect(items.dimensions.conversationQuality.anchor.appliesWithItem).toBeUndefined();
  });

  it('appliesWithItem must name a binary item of the same dimension', () => {
    const raw = JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'judge-items.json'), 'utf8')) as {
      dimensions: {
        salesEffectiveness: { anchors: { appliesWithItem?: string }[] };
        conversationQuality: { anchor: { appliesWithItem?: string } };
      };
    };
    expect(judgeItemsSchema.safeParse(raw).success).toBe(true);

    const withSa1 = (id: string): unknown => {
      const copy = structuredClone(raw);
      const sa1 = copy.dimensions.salesEffectiveness.anchors[0];
      if (sa1) sa1.appliesWithItem = id;
      return copy;
    };
    // Another dimension's id: never declared on SE, so SA1 would vanish silently.
    const crossDimension = judgeItemsSchema.safeParse(withSa1('CQ3'));
    expect(crossDimension.success).toBe(false);
    expect(crossDimension.error?.issues[0]?.message).toContain(
      'salesEffectiveness anchor SA1: appliesWithItem "CQ3" is not a salesEffectiveness binary item id',
    );
    // Well-formed but non-existent id.
    expect(judgeItemsSchema.safeParse(withSa1('SE9')).success).toBe(false);

    const qa1 = structuredClone(raw);
    qa1.dimensions.conversationQuality.anchor.appliesWithItem = 'CQ3';
    expect(judgeItemsSchema.safeParse(qa1).success).toBe(true);
    qa1.dimensions.conversationQuality.anchor.appliesWithItem = 'SE6';
    expect(judgeItemsSchema.safeParse(qa1).success).toBe(false);
  });

  it('every id declared by any scenario resolves against the rubric', () => {
    const set = loadScenarioSet();
    for (const scenario of set.scenarios) {
      const ja = scenario.judgeApplicability;
      for (const id of ja.factuality) expect(ids.factuality, scenario.scenarioId).toContain(id);
      for (const id of ja.compliance) expect(ids.compliance, scenario.scenarioId).toContain(id);
      for (const id of ja.salesEffectiveness)
        expect(ids.salesEffectiveness, scenario.scenarioId).toContain(id);
      for (const id of ja.conversationQuality)
        expect(ids.conversationQuality, scenario.scenarioId).toContain(id);
    }
  });
});
