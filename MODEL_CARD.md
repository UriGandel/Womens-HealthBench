# Model card: next-day symptom burden forecast

## Model details

- **Version:** `healthbench-synthetic-gb-0.1.0`
- **Type:** histogram gradient-boosted binary classifier
- **Status:** experimental research benchmark
- **Output:** probability that tomorrow's mean normalized symptom burden is at
  least 0.5

The production alpha uses `tomorrow-gently-transparent-0.2.0`. Version 0.2 only
allows separately logged spotting or flow on the latest check-in date to supply
the existing cycle-context input. A separate operational calendar now displays
approximate phases, but those estimates do not change the symptom probability.
Synthetic wearable results must not change the live model. Further promotion
requires incremental value on consented non-synthetic data, a new model
version, a validation report, an updated model card, and a tested rollback
path.

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

## Optional cycle-history boundary

Every check-in requires an explicit None, Spotting, or Flow response. Separate
cycle-history editing remains optional and is limited to 120 days; an edit may
replace operational calendar context on the same date without rewriting the
completed research row. Calendar projections require at least three logged
flow starts, cover no more than two cycles/90 days, and are suppressed for
insufficient or highly variable histories. They are excluded from research
exports and the live symptom model and are never presented as fertility,
contraception, or confirmation of ovulation.

## Menstrual-phase research models

The menstrual-phase estimate is separate from the next-day symptom-burden
model described above. It does not replace `/v1/forecast`, contribute features
to it, or change its probability.

Two restricted-data phase models share one frozen participant split and 5,398
eligible examples:

- `mcphases-broad-0.1.0` is the 161-feature broad wearable reference. Its test
  macro-F1 is 0.307 (participant-bootstrap 95% CI 0.257–0.357). It is exposed
  only as a public developer API for complete pre-engineered feature vectors;
  the mobile app never calls it.
- `mcphases-app-common-0.2.0` is the 26-feature app-compatible candidate. Its
  test macro-F1 is 0.270 (95% CI 0.225–0.305). The 0.037 difference records
  the performance cost observed after restricting inputs to deployable
  app-common features.

Both classify the target day as `Fertility`, `Follicular`, `Luteal`, or
`Menstrual` from the previous seven complete days. They are experimental
research prototypes, not clinically validated models and not future fertility
forecasts. Probabilities are not shown because calibration is poor.

The Cycle screen places the v0.2 result and calendar-history rules in one
estimated-phases experience. v0.2 supplies only its contract-valid target-day
signal; rules supply later calendar projections. Agreement or disagreement may
be described to the user, but the signals are not numerically combined into a
new unevaluated prediction. If v0.2 is unavailable or has fewer than four
usable days, rule estimates remain available and are still identified as
rule-derived.

For v0.2, RMSSD statistics use `hrv_ms` only when the recorded method is
`rmssd`; SDNN remains missing. The target day is always excluded. “Fertility”
is displayed only as the source dataset's class label and never as a claim
about fertility, ovulation, contraception, conception, or diagnosis.

Serialized models remain private, are loaded from environment-configured paths,
and fail independently. Restricted source rows, participant feature tables,
split identities, and row-level predictions are not distributed.
