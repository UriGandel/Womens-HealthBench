# Privacy and research data policy

## Separation of purposes

Operational consent is required to provide the private forecasting service.
Pseudonymous research contribution is also an explicit condition of
participation. Enrollment and later consent-version changes require both
confirmations; consent version and changes are auditable. A participant who
does not wish to continue can delete the account, which ends participation and
removes all account-linked operational and research records.

Optional health-app connection is read-only. It imports no more than 31 local
calendar days of daily summaries plus four completed six-hour aggregates per
day for activity, ordinary heart rate, HRV with method, respiratory rate, and
oxygen saturation. Each research interval uses a relative day and bucket index,
not an absolute date or timestamp. The app does not request reproductive,
fertility, ECG, location, workout-route, or clinical-record permissions.

Optional cycle tracking is enabled through a separate in-context
acknowledgement. It stores up to 120 local calendar days containing only
spotting or flow status. Separately logged cycle history is operational data:
it can correct the participant calendar and matching-date forecast context, but
it is not exported to the research dataset. Every check-in separately requires
an explicit None, Spotting, or Flow response; that self-report remains part of
the check-in and research row. Cycle values already submitted
inside a completed check-in remain part of that check-in and its research row.
Disabling cycle tracking deletes the separate server history, sync receipts,
and encrypted local queue/cache without rewriting completed check-ins.
The client sends its local calendar date with cycle requests; the API accepts
only dates within one day of UTC and physically prunes expired cycle rows on
the next account or cycle access.

The account store holds operational identity. Operational
wearable summaries are stored separately from manual check-ins. The research
store uses a random research identifier connected through a separately
protected mapping. The research representation uses `day_in_study`, not
calendar dates, and excludes account identifiers, names, email addresses,
free text, platform and source-app provenance, source record IDs, device and
advertising identifiers, raw samples and timestamps, IP addresses, location,
routes, and contacts.

These records are **pseudonymous, not anonymous**. Removing direct identifiers
does not eliminate re-identification risk, especially in longitudinal health
data.

## Data lifecycle

- Collect only the structured fields documented in the public schema.
- Approximate phase and next-period projections are operational wellness
  estimates only. Never export them as research truth, feed them into the live
  symptom probability, or label dates fertile, safe, or infertile.
- Encrypt transport and storage. Do not put health payloads or authorization
  material in logs, crash reports, or analytics.
- Create a research row for every contributed participant-day; sensor-only days
  contain no symptom target.
- Create separate pseudonymous six-hour research aggregates without absolute
  dates, platform provenance, or raw timestamps.
- “Disconnect and delete imported health data” stops reads, clears the
  encrypted wearable queue/cache, deletes server summaries and their research
  contribution, and preserves manual check-ins. OS authorization must be
  revoked separately in system settings.
- Account deletion removes account-linked operational and research data,
  including the protected identity-to-research mapping.
- “Disable and delete cycle history” removes separately logged cycle records
  while preserving the account, check-ins, and their existing research rows.
- Restrict research exports to an administrator-only offline job. There is no
  public export endpoint.
- Export only pseudonymous, relative-day records. Review aggregate outputs for
  small groups and disclosure risk before sharing.

Record-level tester data is private and must not be committed, published, or
used in demos. A later public release requires documented consent coverage,
ethics/IRB determination where applicable, source-license review, and expert
de-identification assessment. mcPHASES data must never be redistributed by this
project.

## Safety communication

Every forecast is labeled experimental wellness information. It is not a
diagnosis or medical advice and should not delay professional care. Product
copy must describe model factors as non-causal associations. Phase projections
must also state that they do not confirm ovulation and must not be used for
contraception or fertility decisions.

## Verification checklist

- Enrollment and data endpoints reject missing, false, or outdated mandatory
  consent.
- Every accepted check-in and imported wearable day produces the expected
  merged pseudonymous participant-day row.
- Account deletion removes all account-linked rows and mapping keys.
- Exports have no direct/account identifiers, absolute dates, free text, device
  IDs, network identifiers, or location.
- Logs and analytics contain no check-in payloads.
- Unauthorized accounts cannot read or delete another participant's data.
