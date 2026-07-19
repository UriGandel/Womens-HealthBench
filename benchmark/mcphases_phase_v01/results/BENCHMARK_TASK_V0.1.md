# mcPHASES Benchmark Task v0.1.0

## Intended task

Predict the current participant-day menstrual phase from passive wearable
summaries observed during the previous 7 complete calendar days.

## Prediction contract

- Unit: one participant-study-interval-day.
- Prediction timestamp: start of the labelled target day.
- Lookback: target day minus 7 through target day minus 1.
- Outcome classes: Fertility, Follicular, Luteal, Menstrual.
- Eligibility: a valid four-class phase label and passive observations on at
  least 4 distinct lookback days.
- Included source files: active_minutes.csv, resting_heart_rate.csv, heart_rate_variability_details.csv, sleep.csv, respiratory_rate_summary.csv, computed_temperature.csv.
- Excluded inputs: participant identity, study interval, target-day wearable
  data, hormones, symptom/self-report fields, and phase labels from any input day.
- Exact full-row duplicates are removed within each included source table.
- Non-identical records sharing a candidate timestamp/day are preserved and
  reduced with a prespecified daily median; source-row counts remain features.
- Across the seven-day window each daily feature is summarized by mean,
  population standard deviation, minimum, maximum, and nonmissing-day count.

## Frozen split

Participants are deterministically assigned approximately 60%/20%/20% to
train/validation/test using seed 20260719. Every study interval belonging
to a participant remains in one split. No participant appears in multiple splits.

## Evaluation

- Primary metric: macro-F1.
- Secondary: balanced accuracy, accuracy, weighted F1, per-class recall,
  log loss, and confusion matrix.
- Test uncertainty: 1,000-replicate participant-cluster bootstrap interval for
  macro-F1.
- Baselines: class-prior, class-balanced multinomial logistic regression, and
  histogram gradient-boosted trees.

## Prohibited interpretation

This small observational benchmark does not diagnose disease, establish
clinical utility, or validate deployment in the proposed mobile application.
