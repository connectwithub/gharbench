# stats-bridge

Reference inter-rater agreement statistics for GharBench.

## Never hand-edit this beyond `agreement.py`

This is the **only** Python in the repository, and it exists for one reason:
Krippendorff's alpha, Cohen's kappa and their weighted variants are easy to
reimplement _almost_ correctly. Missing data, the level-of-measurement
difference function, and the small-sample correction each have a subtly wrong
version that produces plausible numbers. A judge-agreement figure that is
"about right" is worse than none, because it will be quoted.

So: we shell out to the published packages (`krippendorff`, `scipy`,
`statsmodels`) and treat their output as ground truth. Do not port these
statistics to TypeScript. Do not add a "faster" pure-JS path. If you need a new
statistic, add it here, add a golden vector for it, and keep going.

## Setup

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Use

```sh
echo '{"raters":{"A":[1,2,3],"B":[1,2,2]},"level":"ordinal"}' \
  | .venv/bin/python agreement.py
```

Input:

| field    | meaning                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `raters` | object of `name -> array of labels`. Labels must be **numeric**; `null` means that rater did not score that unit. Every rater must supply the same number of units. |
| `level`  | `nominal` (default), `ordinal`, `interval` or `ratio`. Drives Krippendorff's difference function.                                                                   |

Output:

| field                                                              | scope                                                                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `krippendorff_alpha`                                               | all raters, handles missing data natively                                                                 |
| `cohen_kappa`, `weighted_kappa` (quadratic), `spearman`, `pearson` | the **first two** raters, pairwise-complete cases only - these four statistics are pairwise by definition |

## Golden vectors

`pnpm stats:test` runs `agreement.golden.test.ts`, which feeds the canonical
Krippendorff 4-observer x 12-unit matrix through this script and asserts:

- nominal alpha = **0.743** (+/- 0.001)
- interval alpha = **0.849** (+/- 0.001)

If those drift, a dependency changed its semantics and every agreement number
already published needs rechecking. The suite is excluded from `pnpm test` and
from the default CI job because it needs a Python toolchain.
