# Related-work stub: SISTER (ADR-0030)

Drop-in paragraph for the paper's Related Work; keys refer to `refs.bib`.

> Our judge-robustness and release methodology adapts several practices from
> SISTER, an incremental-instruction creative-writing benchmark
> [@singh2026sister_software; @singh2026sister_dataset]: running every panel
> judgment in original and reversed item order and reporting the flip rate,
> auditing each atomic rubric item with quoted evidence before any verdict,
> scenario-clustered bootstrap confidence intervals, and a dual-DOI release
> with per-artifact dataset configs. The underlying techniques trace to their
> canonical sources - position-bias order-swapping to MT-Bench
> [@zheng2023judging; @wang2024fair], judge panels to PoLL [@verga2024poll],
> self-preference auditing to Panickssery et al.
> [@panickssery2024selfpreference], pass^k to tau-bench [@yao2024taubench;
> @barres2025tau2], and the cluster bootstrap to standard statistics
> [@davison1997bootstrap] - we cite SISTER for the specific combination and
> operational discipline we reuse.

Rules of engagement (from the 2026-08-28 research pass):

- Cite the two Zenodo DOIs wherever a SISTER-tagged practice appears
  (ADR-0030 maps them: item-order ablation, evidence-first audit framing,
  clustered bootstrap, CITATION.cff, dual DOIs, HF config split).
- Do NOT cite SISTER for the generic ideas - use the canonical entries above.
- SISTER is a self-published Zenodo artifact ("manuscript in preparation"),
  not peer-reviewed - frame it accurately. Before submission, re-check
  arXiv/OpenReview: if the paper has landed anywhere citable, switch
  `@singh2026sister_paper` to that venue's entry.
- Zenodo metadata verified against the live API 2026-08-28 (titles, v0.1.0,
  2026-08-15, dataset creator = Singh alone).
