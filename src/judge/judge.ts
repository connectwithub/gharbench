/**
 * One judge scoring one case on one dimension.
 *
 * The model call is isolated behind `JudgeCallFn` so tests (and the offline
 * pipeline test) drive the whole judge path with a fake caller for $0 - the
 * same seam the Contestant abstraction uses. `judgeCase` owns prompt
 * assembly, parsing, and the single retry: an invalid reply is sent back once
 * with the validation error appended; a second failure is recorded as a
 * structured error (failure is data), never thrown.
 */

import { generateText } from 'ai';

import { sha256 } from '../env/db.js';
import { cacheCallOptions, resolveModel, supportsSamplingParams } from '../providers/registry.js';
import { meterCall, type CostMeter } from '../telemetry/cost.js';
import type { JudgeDimension, JudgeItems } from '../run/judgeItems.js';
import { anchorsFor, buildJudgeSystem, buildJudgeUser, type JudgeCaseInput } from './prompt.js';
import { parseJudgeOutput, type JudgeVerdict } from './schema.js';

export type JudgeCallFn = (system: string, user: string) => Promise<string>;

export interface JudgeCaseResult {
  caseId: string;
  dimension: JudgeDimension;
  /** 1 = first reply parsed; 2 = needed the retry. */
  attempts: number;
  /** sha256 of the system block - the cache prefix witness for the manifest. */
  promptSha: string;
  outcome:
    | { kind: 'verdict'; verdict: JudgeVerdict }
    | { kind: 'error'; code: 'no_json' | 'schema_violation' | 'call_failed'; detail: string };
}

export async function judgeCase(opts: {
  call: JudgeCallFn;
  items: JudgeItems;
  dimension: JudgeDimension;
  input: JudgeCaseInput;
  sourceDocuments: string;
}): Promise<JudgeCaseResult> {
  const { call, items, dimension, input } = opts;
  const system = buildJudgeSystem(items, dimension, opts.sourceDocuments);
  const user = buildJudgeUser(input);
  const anchorIds = anchorsFor(items, dimension).map((a) => a.id);
  const promptSha = sha256(system);

  let attempts = 0;
  let lastDetail = '';
  let lastCode: 'no_json' | 'schema_violation' | 'call_failed' = 'call_failed';

  for (const retryUser of [
    user,
    // Retry once, with the reason. This changes the request suffix only; the
    // cached system prefix is unaffected. A transport failure (call_failed)
    // produced no reply at all, so that retry re-sends the plain prompt -
    // telling the judge its non-existent "previous reply was invalid" primes
    // apologies and fragments instead of the full JSON.
    () =>
      lastCode === 'call_failed'
        ? user
        : `${user}\n\nYour previous reply was invalid: ${lastDetail}\n` +
          'Reply again with ONLY the corrected JSON object.',
  ]) {
    attempts += 1;
    let raw: string;
    try {
      raw = await call(system, typeof retryUser === 'string' ? retryUser : retryUser());
    } catch (err) {
      lastCode = 'call_failed';
      lastDetail = err instanceof Error ? err.message : String(err);
      continue;
    }
    const parsed = parseJudgeOutput(
      dimension,
      input.applicableItems,
      anchorIds,
      input.messages,
      raw,
    );
    if (parsed.ok) {
      return {
        caseId: input.caseId,
        dimension,
        attempts,
        promptSha,
        outcome: { kind: 'verdict', verdict: parsed.verdict },
      };
    }
    lastCode = parsed.code;
    lastDetail = parsed.detail;
  }

  return {
    caseId: input.caseId,
    dimension,
    attempts,
    promptSha,
    outcome: { kind: 'error', code: lastCode, detail: lastDetail },
  };
}

/**
 * A live caller for one judge ref: temperature 0 (pinned judges, §4.2),
 * cache-first call options keyed on the system-prompt hash, every call
 * metered under role 'judge'.
 */
export function modelJudgeCaller(ref: string, meter: CostMeter, ts: string): JudgeCallFn {
  const resolved = resolveModel(ref);
  const sampling = supportsSamplingParams(ref) ? { temperature: 0 } : {};
  return async (system, user) => {
    const { result } = await meterCall(
      meter,
      { role: 'judge', modelId: resolved.modelId, provider: resolved.provider, ts },
      () =>
        generateText({
          model: resolved.model,
          system,
          messages: [{ role: 'user', content: user }],
          maxOutputTokens: 4096,
          maxRetries: 2,
          ...sampling,
          ...cacheCallOptions(resolved.spec, `gharbench-judge-${sha256(system)}`),
        }),
      (r) => r.usage,
    );
    return result.text;
  };
}
