# Health-app and smartwatch integration

Version 1 supports Apple HealthKit on iOS and Android Health Connect. Apple
Watch, Wear OS, and other compatible devices contribute through those system
stores; there are no direct Fitbit, Garmin, Oura, BLE, or watch-app connections.

## Collected summaries

- sleep duration, assigned to the local wake date
- steps and exercise/activity minutes
- active energy in kilocalories
- resting heart rate
- heart-rate variability with explicit `SDNN` (HealthKit) or `RMSSD`
  (Health Connect) method
- respiratory rate and oxygen saturation
- wrist/skin temperature deviation from a trailing personal baseline

The app also creates four completed local-calendar aggregates per day:
midnight–06:00, 06:00–12:00, 12:00–18:00, and 18:00–midnight. These contain
steps, exercise, active energy, ordinary heart-rate average/minimum/maximum,
HRV, respiratory rate, and oxygen saturation. Sample counts accompany averaged
signals so sparse buckets remain distinguishable from dense ones.

A missing value remains `null`. It is never converted to zero. Manual
sleep-quality, cycle, stress, and symptom ratings remain self-reported; wearable
sleep can only prefill the editable sleep-duration field.

The app requests read permission only. Platform aggregation and local
normalization happen before upload. It does not upload raw samples, sample
timestamps, timezone, absolute temperature, device identifiers, source-app
identifiers, record IDs, routes, or location.

## Synchronization

The client reads the current local calendar day plus the previous 30 days on
connection, explicit “Sync now,” and foreground refresh no more than every 12
hours. Re-reading a full window incorporates edited/deleted source records and
timezone changes. The source stores retain measurements, so completed buckets
can be reconstructed later without background execution. Android requests
neither background nor extended-history access.

`POST /v1/wearable-days:sync` accepts at most 31 complete daily snapshots.
Sync UUIDs are idempotent; reuse with a different payload is rejected. Records
are isolated by account/date, omitted metrics replace earlier values with
`null`, and an all-null day removes that imported day. Historical imports
rebuild the participant's relative research timeline.

`POST /v1/wearable-intervals:sync` accepts at most 124 unique date/bucket
aggregates. It has the same account isolation, full-replacement, all-null
deletion, and idempotent UUID behavior as the daily endpoint. Incomplete current
buckets are never uploaded.

## Prediction boundary

Wearable-only participant-days are valid feature observations but cannot create
symptom targets. Synthetic wearable signals test the pipeline and leakage
protections only. The live `tomorrow-gently-transparent-0.2.0` forecast does not
use imported wearable values. That remains unchanged until consented
non-synthetic evaluation shows better AUROC or Brier score with calibration no
worse than the no-wearable ablation. Version 0.2 only permits separately logged
cycle status to replace period context when it matches the latest check-in
date.

The separate authenticated menstrual-phase endpoint uses five daily fields:
sleep duration, resting heart rate, RMSSD HRV, respiratory rate, and peripheral
temperature deviation. For a requested target date it reads only that account's
daily summaries from `t−7` through `t−1`; target-day values are excluded. Each
field contributes seven-day mean, population standard deviation, minimum,
maximum, and nonmissing-day count, plus the overall observed-day count, for an
exact 26-feature contract. At least four distinct days must contain a supported
measurement.

HRV method semantics are strict: `hrv_ms` contributes only when
`hrv_method == "rmssd"`. SDNN is missing for this model and is never converted
or substituted. Before inference, generated columns must exactly match the
private model's stored feature names.

The Cycle screen treats the model and calendar history as two signals in the
same estimated-phases experience. The model supplies only its supported
target-day label; calendar rules continue future projections. A missing model
or insufficient wearable history does not suppress those rule estimates or the
separate symptom forecast. Neither signal is fertility, contraception,
ovulation, conception, diagnostic, or medical guidance.

## User control

The Health Data screen shows availability, supported metrics, imported-day
count, last successful sync, pending encrypted batches, and permission links.
“Disconnect and delete health data” clears local imports and queues, server
summaries, and their research contribution while retaining manual check-ins.
The user is then directed to system settings to revoke OS permission.
