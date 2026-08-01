/**
 * Golden vectors for the reference stats bridge.
 *
 * The canonical Krippendorff worked example: 4 observers x 12 units, with
 * missing data. Its published values are nominal alpha = 0.743 and interval
 * alpha = 0.849. If either drifts, a dependency changed its semantics and
 * every agreement number the benchmark has published needs rechecking.
 *
 * Run with `pnpm stats:test`. Excluded from `pnpm test` because it spawns
 * python3.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const BRIDGE_DIR = import.meta.dirname;
const SCRIPT = join(BRIDGE_DIR, 'agreement.py');
const VENV_PYTHON = join(BRIDGE_DIR, '.venv', 'bin', 'python');
const PYTHON = existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3';

function pythonReady(): boolean {
  try {
    execFileSync(PYTHON, ['-c', 'import krippendorff, scipy, statsmodels'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const READY = pythonReady();
if (!READY) {
  console.warn(
    `\nstats-bridge: skipping golden vectors - "${PYTHON}" cannot import the reference packages.\n` +
      'Set it up with:  python3 -m venv stats-bridge/.venv && stats-bridge/.venv/bin/pip install -r stats-bridge/requirements.txt\n',
  );
}

interface AgreementResult {
  n_raters: number;
  n_units: number;
  level: string;
  krippendorff_alpha: number;
  cohen_kappa: number | null;
  weighted_kappa: number | null;
  spearman: number | null;
  pearson: number | null;
  n_complete_pairs: number;
  pairwise_raters: string[];
}

function runAgreement(payload: unknown): AgreementResult {
  const stdout = execFileSync(PYTHON, [SCRIPT], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
  return JSON.parse(stdout) as AgreementResult;
}

/** Krippendorff's canonical 4 observers x 12 units matrix; null = not scored. */
const CANONICAL = {
  A: [1, 2, 3, 3, 2, 1, 4, 1, 2, null, null, null],
  B: [1, 2, 3, 3, 2, 2, 4, 1, 2, 5, null, 3],
  C: [null, 3, 3, 3, 2, 3, 4, 2, 2, 5, 1, null],
  D: [1, 2, 3, 3, 2, 4, 4, 1, 2, 5, 1, null],
};

describe.skipIf(!READY)('Krippendorff canonical 4x12 golden vectors', () => {
  it('nominal alpha = 0.743 (+/- 0.001)', () => {
    const result = runAgreement({ raters: CANONICAL, level: 'nominal' });
    expect(result.n_raters).toBe(4);
    expect(result.n_units).toBe(12);
    expect(result.krippendorff_alpha).toBeGreaterThan(0.743 - 0.001);
    expect(result.krippendorff_alpha).toBeLessThan(0.743 + 0.001);
  });

  it('interval alpha = 0.849 (+/- 0.001)', () => {
    const result = runAgreement({ raters: CANONICAL, level: 'interval' });
    expect(result.krippendorff_alpha).toBeGreaterThan(0.849 - 0.001);
    expect(result.krippendorff_alpha).toBeLessThan(0.849 + 0.001);
  });
});

describe.skipIf(!READY)('pairwise statistics', () => {
  it('reports perfect agreement as alpha = kappa = rho = 1', () => {
    const result = runAgreement({
      raters: { A: [1, 2, 3, 4, 5], B: [1, 2, 3, 4, 5] },
      level: 'ordinal',
    });
    expect(result.krippendorff_alpha).toBeCloseTo(1, 9);
    expect(result.cohen_kappa).toBeCloseTo(1, 9);
    expect(result.weighted_kappa).toBeCloseTo(1, 9);
    expect(result.spearman).toBeCloseTo(1, 9);
    expect(result.pearson).toBeCloseTo(1, 9);
    expect(result.n_complete_pairs).toBe(5);
  });

  it('scores only pairwise-complete cases for the pairwise statistics', () => {
    const result = runAgreement({
      raters: { A: [1, 2, null, 4], B: [1, 2, 3, null], C: [1, 2, 3, 4] },
      level: 'ordinal',
    });
    expect(result.pairwise_raters).toEqual(['A', 'B']);
    expect(result.n_complete_pairs).toBe(2);
    expect(result.n_raters).toBe(3);
  });

  it('ranks weighted kappa above plain kappa when disagreements are near-misses', () => {
    // B is one category off on two units: quadratic weighting should forgive
    // that far more than the unweighted statistic does.
    const result = runAgreement({
      raters: { A: [1, 2, 3, 4, 5, 1, 2, 3], B: [1, 2, 4, 4, 5, 1, 3, 3] },
      level: 'ordinal',
    });
    expect(result.weighted_kappa!).toBeGreaterThan(result.cohen_kappa!);
  });
});

describe.skipIf(!READY)('input validation', () => {
  it('rejects a single rater', () => {
    expect(() => runAgreement({ raters: { A: [1, 2, 3] } })).toThrow();
  });

  it('rejects ragged rater arrays', () => {
    expect(() => runAgreement({ raters: { A: [1, 2, 3], B: [1, 2] } })).toThrow();
  });

  it('rejects an unknown level of measurement', () => {
    expect(() => runAgreement({ raters: { A: [1, 2], B: [1, 2] }, level: 'vibes' })).toThrow();
  });
});
