# Symptom forecasting benchmark

## Question and target

The benchmark asks: using information available after a participant's day-*t*
check-in, can a model estimate whether day *t+1* will have high symptom burden?
Each of fatigue, brain fog, headache/migraine, pelvic pain, and mood disruption
is divided by four. Their mean is the normalized burden. The binary target is
one when next-day burden is at least `0.5`.

This is an experimental wellness benchmark, not a diagnostic or clinical
validation study. Synthetic results demonstrate the pipeline and do not support
claims about real people.

## Inputs and leakage boundary

Features contain current and 3/7-day trailing symptom burden, sleep, stress,
optional activity, period status, and cyclical encoding of cycle day. Every
feature row retains `feature_day` and `target_day`; construction fails unless
`feature_day < target_day`. No future interpolation or participant-wide
normalization is used. Numeric missing values are imputed using training data
inside each model pipeline.

The public record schema is
[`schemas/research-checkin.schema.json`](../schemas/research-checkin.schema.json).
The mobile alpha does not collect activity; that nullable field exists only to
support permitted local normalization of research datasets that contain it.

## Predefined comparisons

The same four approaches are compared:

1. Previous-day normalized burden.
2. Causal participant historical rate, computed only from already-observed
   outcomes and smoothed toward the training-fold rate.
3. Logistic regression using cycle context only.
4. Histogram gradient boosting using all documented lag/current features.

Two protocols answer different questions:

- Participant-grouped cross-validation holds whole participants out. A runtime
  assertion prevents a participant from appearing in both train and test.
- A 70/30 rolling temporal holdout trains and tests separately within each
  participant. A runtime assertion ensures the latest training target precedes
  the earliest test target.

Reports include AUROC, AUPRC, Brier score, 10-bin calibration and expected
calibration error, feature missingness, and per-participant temporal results.
AUROC/AUPRC are `null` when a slice contains only one target class.

The report marks the gradient-boosted result as predictive only when it beats
the strongest predefined baseline on discrimination or Brier score and its
calibration error is no worse than the best baseline. This conservative
mechanical flag does not establish clinical utility.

## Reproduce

From `benchmark/`:

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/healthbench-benchmark --output artifacts/report.json
.venv/bin/pytest
```

Generation defaults to 42 simulated participants, 84 days, and seed `20260719`.
Use `--participants`, `--days`, and `--seed` to run sensitivity checks. Reports
include a generation timestamp, so metrics are deterministic while files are
not byte-identical across run times.

## Restricted mcPHASES adapter boundary

mcPHASES is restricted access and must be obtained under its own data-use
terms. The repository contains neither a downloader nor raw/derived records.
Authorized researchers may normalize a local copy to the public schema outside
this repository, then run:

```bash
healthbench-benchmark \
  --source mcphases-local \
  --input /absolute/private/path/normalized.json \
  --output artifacts/mcphases-report.json
```

The loader refuses raw archive formats and refuses restricted inputs located
inside the repository. Only aggregate reports may be reviewed for release, and
that review remains subject to the source license, consent, ethics, and
re-identification-risk requirements.
