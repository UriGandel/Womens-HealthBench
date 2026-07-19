# Health-app and smartwatch integration

Version 1 supports Apple HealthKit on iOS and Android Health Connect. Apple
Watch, Wear OS, and other compatible devices contribute through those system
stores; there are no direct Fitbit, Garmin, Oura, BLE, or watch-app connections.

## Collected daily summaries

- sleep duration, assigned to the local wake date
- steps and exercise/activity minutes
- active energy in kilocalories
- resting heart rate
- heart-rate variability with explicit `SDNN` (HealthKit) or `RMSSD`
  (Health Connect) method
- respiratory rate and oxygen saturation
- wrist/skin temperature deviation from a trailing personal baseline

A missing value remains `null`. It is never converted to zero. Manual
sleep-quality, cycle, stress, and symptom ratings remain self-reported; wearable
sleep can only prefill the editable sleep-duration field.

The app requests read permission only. Platform aggregation and local
normalization happen before upload. It does not upload raw samples, sample
timestamps, absolute temperature, device identifiers, source-app identifiers,
record IDs, routes, or location.

## Synchronization

The client reads the current local calendar day plus the previous 30 days on
connection, explicit “Sync now,” and foreground refresh no more than every 12
hours. Re-reading a full window incorporates edited/deleted source records and
timezone changes. Android version 1 requests neither background nor extended
history access.

`POST /v1/wearable-days:sync` accepts at most 31 complete daily snapshots.
Sync UUIDs are idempotent; reuse with a different payload is rejected. Records
are isolated by account/date, omitted metrics replace earlier values with
`null`, and an all-null day removes that imported day. Historical imports
rebuild the participant's relative research timeline.

## Prediction boundary

Wearable-only participant-days are valid feature observations but cannot create
symptom targets. Synthetic wearable signals test the pipeline and leakage
protections only. The live `tomorrow-gently-transparent-0.2.0` forecast does not
use imported wearable values. That remains unchanged until consented
non-synthetic evaluation shows better AUROC or Brier score with calibration no
worse than the no-wearable ablation. Version 0.2 only permits separately logged
cycle status to replace period context when it matches the latest check-in
date.

## User control

The Health Data screen shows availability, supported metrics, imported-day
count, last successful sync, pending encrypted batches, and permission links.
“Disconnect and delete health data” clears local imports and queues, server
summaries, and their research contribution while retaining manual check-ins.
The user is then directed to system settings to revoke OS permission.
