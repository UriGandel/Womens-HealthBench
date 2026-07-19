# Model card: next-day symptom burden forecast

## Model details

- **Version:** `healthbench-synthetic-gb-0.1.0`
- **Type:** histogram gradient-boosted binary classifier
- **Status:** experimental research benchmark
- **Output:** probability that tomorrow's mean normalized symptom burden is at
  least 0.5

The production alpha remains `tomorrow-gently-transparent-0.1.0`. Synthetic
wearable results must not change it. Promotion requires incremental value on
consented non-synthetic data, a new model version, a validation report, an
updated model card, and a tested rollback path.

## Intended use

The model is intended to explore an experimental wellness forecast for invited
adults and to evaluate longitudinal data infrastructure. It may help a user
plan for a potentially higher-symptom day. It is not intended to diagnose,
screen for, treat, or rule out a condition; determine pregnancy or fertility;
recommend medication; or replace professional care.

## Data and features

The open benchmark trains on deterministic simulated participant histories.
Synthetic data is suitable for testing reproducibility and leakage controls,
not for estimating real-world accuracy or fairness.

Documented features use only day-*t* or trailing information: current and
3/7-day symptom burden, self-reported sleep/quality and stress, period status,
cycle-day sine/cosine, daily wearable summaries, wearable missingness,
method-separated participant-normalized HRV, and causal temperature deviation.
Five 0–4 symptoms define the target:
fatigue, brain fog, headache/migraine, pelvic pain, and mood disruption.
Missing numeric inputs are median-imputed within the training fold with missing
indicators.

No mcPHASES or private tester record is included or redistributed. Any
restricted dataset evaluation must happen locally under its data-use terms and
export only reviewed aggregate metrics.

## Evaluation

The predefined protocols are participant-grouped cross-validation and
per-participant 70/30 rolling temporal holdouts. Comparators are previous-day
burden, causal participant historical rate, cycle-context logistic regression,
and an otherwise-identical gradient-boosted model without wearables. Reports
include AUROC, AUPRC, Brier score, calibration, missingness, wearable ablation,
and per-participant temporal results.

The pipeline labels the gradient-boosted result predictive only if it beats the
strongest predefined baseline on AUROC or Brier score and its calibration error
is no worse than the best predefined baseline. This is a benchmark reporting
rule, not evidence of clinical validity.

## Limitations and risks

- Synthetic associations may be unrealistic and encode the generator's
  assumptions.
- The proposed real-data source is small and may not represent varied ages,
  races, cycle patterns, contraceptive use, pregnancy states, conditions, or
  symptom-reporting behaviors.
- Self-reported inputs are missing, subjective, and vulnerable to engagement
  bias. Cycle day can be unknown or irregular.
- A calibrated population estimate may still be unreliable for an individual.
- Forecasts can cause false reassurance, anxiety, or inappropriate health
  decisions. Factor descriptions are associative, never causal.
- Longitudinal reproductive-health data has meaningful re-identification and
  misuse risk even after direct identifiers are removed.

## Safeguards and monitoring

Suppress personalized forecasts before seven usable check-ins and communicate
low/medium/high confidence separately from probability. Display: “Experimental
wellness forecast — not a diagnosis or medical advice. Do not delay
professional care because of this result.”

Before deployment on real data, require participant-level leakage review,
temporal validation, calibration review, subgroup and per-participant error
analysis where sample sizes permit, missingness stress tests, consent/license
review, and a rollback path keyed by model version. Monitor input missingness,
probability distribution, calibration when delayed outcomes arrive, service
failures, and consent/deletion correctness. Do not log health payloads.
