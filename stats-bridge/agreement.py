#!/usr/bin/env python3
"""GharBench inter-rater agreement statistics.

REFERENCE IMPLEMENTATION. Do not hand-edit beyond this file, and do not
reimplement these statistics in TypeScript. Krippendorff's alpha in particular
is easy to get subtly wrong (missing data, the level-of-measurement difference
function, the small-sample correction), and a benchmark whose agreement numbers
are "close enough" is a benchmark nobody can trust. We shell out to the
published Python packages and treat their output as ground truth.

Input (stdin, or a path as argv[1]):
    {
      "raters": {"A": [1, 2, null, 3], "B": [1, 2, 3, 3]},
      "level":  "nominal" | "ordinal" | "interval" | "ratio"
    }
    Labels must be numeric; `null` means "this rater did not score this unit".
    Every rater must supply the same number of units.

Output (stdout): a JSON object with krippendorff_alpha over all raters, and
cohen_kappa / weighted_kappa / spearman / pearson over the pairwise-complete
cases of the FIRST TWO raters (those four statistics are pairwise by
definition).
"""

from __future__ import annotations

import json
import sys

import krippendorff
import numpy as np
from scipy import stats
from statsmodels.stats.inter_rater import cohens_kappa, to_table

LEVELS = ("nominal", "ordinal", "interval", "ratio")


def _matrix(raters: dict[str, list]) -> np.ndarray:
    widths = {len(v) for v in raters.values()}
    if len(widths) != 1:
        raise ValueError(f"every rater must score the same number of units, got {sorted(widths)}")
    return np.array(
        [[np.nan if v is None else float(v) for v in vals] for vals in raters.values()],
        dtype=float,
    )


def compute(payload: dict) -> dict:
    raters = payload.get("raters") or {}
    if len(raters) < 2:
        raise ValueError("need at least two raters")
    level = payload.get("level", "nominal")
    if level not in LEVELS:
        raise ValueError(f"level must be one of {LEVELS}, got {level!r}")

    data = _matrix(raters)
    names = list(raters)
    result = {
        "n_raters": int(data.shape[0]),
        "n_units": int(data.shape[1]),
        "level": level,
        "krippendorff_alpha": float(
            krippendorff.alpha(reliability_data=data, level_of_measurement=level)
        ),
        "pairwise_raters": names[:2],
    }

    a, b = data[0], data[1]
    mask = ~np.isnan(a) & ~np.isnan(b)
    a, b = a[mask], b[mask]
    result["n_complete_pairs"] = int(a.size)

    if a.size < 2:
        result.update(cohen_kappa=None, weighted_kappa=None, spearman=None, pearson=None)
        return result

    table = to_table(np.column_stack([a, b]).astype(int))[0]
    single_category = table.shape[0] < 2
    result["cohen_kappa"] = 1.0 if single_category else float(cohens_kappa(table, return_results=False))
    result["weighted_kappa"] = (
        1.0 if single_category else float(cohens_kappa(table, wt="quadratic", return_results=False))
    )
    result["spearman"] = float(stats.spearmanr(a, b).statistic)
    result["pearson"] = float(stats.pearsonr(a, b).statistic)
    return result


def main(argv: list[str]) -> int:
    source = sys.stdin.read() if len(argv) < 2 or argv[1] == "-" else open(argv[1]).read()
    json.dump(compute(json.loads(source)), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
