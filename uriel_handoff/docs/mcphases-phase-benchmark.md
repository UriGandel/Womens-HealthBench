# mcPHASES Phase Benchmark v0.1 — integration handoff

## What this adds

This is a separate restricted-data benchmark track for predicting the current
menstrual phase from the previous seven days of passive wearable summaries.
It contains a reproducible local builder and reviewed aggregate results.

It does **not** replace the app's existing next-day symptom-burden forecast.
Those are different tasks, targets, feature contracts, and model outputs.

## Safe repository changes

Copy this handoff's `benchmark/mcphases_phase_v01/` directory into the same
location in the repository and add a link to it from `docs/benchmark.md` and
the root `README.md`.

The included files are code, task documentation, feature documentation, source
hashes, and aggregate metrics. They contain no raw or participant-level rows.

Recommended optional demo integration:

- Add a read-only “mcPHASES phase benchmark v0.1” research-results card.
- Display 5,398 examples, 42 participants, participant-disjoint splits,
  selected histogram-gradient-boosting baseline, test macro-F1 0.307, and
  participant-bootstrap 95% CI 0.257–0.357.
- Label it “research benchmark; not a live prediction or medical advice.”

## Do not do

- Do not commit mcPHASES CSV files or normalized participant-day data.
- Do not commit `private/benchmark_examples.*`, `split_manifest.csv`, row-level
  predictions, or trained `.joblib` files without a separate license and
  disclosure review.
- Do not replace `services/api/app/forecasting.py` with this model.
- Do not change `/v1/forecast` to return menstrual phase.
- Do not claim fertility, diagnosis, clinical validity, or deployment readiness.

## Why the trained model is not wired into the app

The benchmark model expects 161 engineered features derived from mcPHASES
Fitbit-style summaries. The app currently collects a different Apple
Health/Health Connect daily schema. Activity granularity, sleep fields,
temperature representation, and HRV method semantics are not feature-equivalent.
Loading the model against those inputs would silently create training-serving
skew and an invalid result.

Live phase inference requires a separately versioned feature adapter, feature
parity tests, calibration, and validation on app-schema data. That is post-MVP
work.

## Verified aggregate result

- Eligible examples: 5,398
- Participants: 42
- Frozen split: 25 train / 8 validation / 9 test participants
- All four phase classes occur in every split
- Primary metric: macro-F1
- Selected on validation: histogram gradient boosting
- Test macro-F1: 0.307
- Participant-bootstrap 95% CI: 0.257–0.357
- Test balanced accuracy: 0.313
- Limitation: menstrual recall 0.141 and poor probability calibration; do not
  deploy this baseline.
