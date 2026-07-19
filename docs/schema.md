# Public research schema

Version `2.0.0` defines one pseudonymous participant-day observation. A row can
contain a manual self-report, wearable daily summaries, or both, indicated by
`has_self_report` and `has_wearable`. Ratings are integers from 0
(none/lowest) through 4 (most/highest). Whenever `has_self_report=true`, every
symptom target field is complete. Missing wearable measurements are JSON
`null`, never zero or a sentinel.

`participant_id` is a random research identifier, not an application account
identifier. `day_in_study` starts at zero and preserves intervals without
exposing calendar dates. The schema uses `additionalProperties: false` to
prevent accidental export of unreviewed fields.

Wearable fields are nullable daily aggregates: sleep minutes, steps, activity
minutes, active energy, resting heart rate, HRV value and method, respiratory
rate, oxygen saturation, and peripheral temperature deviation from a causal
personal baseline. HRV method is always explicit because SDNN and RMSSD are not
interchangeable raw values.

Exports merge operational check-ins and wearable summaries by participant and
relative day. They exclude absolute dates, health platform, device/source
provenance, source record IDs, and account identifiers. `source` describes
whether an example is simulated or a permitted local research adapter without
embedding a filename or institution identifier.

Examples in `synthetic-example-records.json` are hand-authored simulations and
contain no tester or mcPHASES information. A schema addition requires a semantic
version change and a privacy review.
