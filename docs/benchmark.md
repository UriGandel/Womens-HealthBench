# Symptom forecasting benchmark

## Question and target

The benchmark asks: using information available through participant day *t*,
can a model estimate whether a manual self-report on day *t+1* will have high
symptom burden? A wearable-only day can be a feature day, but it never supplies
the symptom target.
Each of fatigue, brain fog, headache/migraine, pelvic pain, and mood disruption
is divided by four. Their mean is the normalized burden. The binary target is
one when next-day burden is at least `0.5`.

This is an experimental wellness benchmark, not a diagnostic or clinical
validation study. Synthetic results demonstrate the pipeline and do not support
claims about real people.

## Inputs and leakage boundary

Features contain current and 3/7-day trailing symptom burden, manual sleep and
stress, period status, cyclical encoding of cycle day, wearable daily metrics,
missingness indicators, participant-normalized HRV separated by SDNN/RMSSD,
and trailing causal temperature deviation. Every
feature row retains `feature_day` and `target_day`; construction fails unless
`feature_day < target_day`. No future interpolation or participant-wide
normalization is used. Numeric missing values are imputed using training data
inside each model pipeline.

The public record schema is
[`schemas/research-checkin.schema.json`](../schemas/research-checkin.schema.json).
Synthetic wearable signals exist only to exercise pipeline, missingness, and
leakage protections. Their results are labeled simulation evidence.

## Predefined comparisons

Five approaches are compared:

1. Previous-day normalized burden.
2. Causal participant historical rate, computed only from already-observed
   outcomes and smoothed toward the training-fold rate.
3. Logistic regression using cycle context only.
4. Histogram gradient boosting without wearable features.
5. The same histogram gradient boosting pipeline with wearable features.

Two protocols answer different questions:

- Participant-grouped cross-validation holds whole participants out. A runtime
  assertion prevents a participant from appearing in both train and test.
- A 70/30 rolling temporal holdout trains and tests separately within each
  participant. A runtime assertion ensures the latest training target precedes
  the earliest test target.

Reports include AUROC, AUPRC, Brier score, 10-bin calibration and expected
calibration error, feature missingness, and per-participant temporal results.
AUROC/AUPRC are `null` when a slice contains only one target class.

The wearable ablation qualifies only when the wearable model improves AUROC or
Brier score over the otherwise-identical non-wearable model and calibration is
no worse. `wearable_promotion_eligible` is always false for synthetic input.
This mechanical flag does not establish clinical utility.

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

## mcPHASES menstrual-phase benchmarks

The reviewed
[`benchmark/mcphases_phase_v01`](../benchmark/mcphases_phase_v01/results/README.md)
directory is a separate four-class task: predict the labelled current
participant-day phase from passive summaries on `t−7` through `t−1`. It
contains the reproducible local builder, frozen task definition, 161-feature
dictionary, source manifest, and aggregate metrics. It contains no raw or
participant-level data, split identities, row-level predictions, or serialized
models.

Both benchmark versions use the same 5,398 eligible examples, the same 42
participants, and the same participant-disjoint 25/8/9 train/validation/test
split:

| Version | Purpose | Features | Test macro-F1 | Participant-bootstrap 95% CI |
| --- | --- | ---: | ---: | ---: |
| v0.1 broad benchmark | Offline reference / public pre-engineered-feature API | 161 | 0.307 | 0.257–0.357 |
| v0.2 app-compatible | Experimental serving candidate | 26 | 0.270 | 0.225–0.305 |

v0.1 uses a broader set of Fitbit-style engineered summaries and is not an
adapter for direct app data. v0.2 restricts the inputs to sleep, resting heart
rate, RMSSD HRV, respiratory rate, and peripheral-temperature deviation that
the app can represent consistently. The 0.037 macro-F1 gap documents the
observed cost of the deployment-compatible feature restriction; it is not a
clinical-utility comparison.

Both models predict the target day's dataset phase label at the start of that
day using seven prior complete days. They are not trained as arbitrary
multi-day forecasts. The mobile experience therefore uses v0.2 for its single
supported target-day signal and the existing calendar-history rules for future
days. It may report whether the two signals agree, but must not silently blend
them into a new unvalidated model output.

The four output labels are `Fertility`, `Follicular`, `Luteal`, and
`Menstrual`. “Fertility” is a source-dataset phase label and must never be
interpreted as “you are fertile,” ovulation confirmation, contraception
guidance, or conception guidance. Probability outputs are withheld because
calibration is poor.

The v0.1 model API accepts exactly the 161 pre-engineered features documented
in the feature dictionary. It does not accept restricted archives, raw
mcPHASES rows, identifiers, or app wearable records. The v0.2 account endpoint
requires authentication and at least four supported lookback days. SDNN is
never converted to RMSSD.
