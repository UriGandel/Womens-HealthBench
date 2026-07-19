# Privacy and research data policy

## Separation of purposes

Operational consent is required to provide the private forecasting service.
Pseudonymous research contribution is also an explicit condition of
participation. Enrollment and later consent-version changes require both
confirmations; consent version and changes are auditable. A participant who
does not wish to continue can delete the account, which ends participation and
removes all account-linked operational and research records.

Optional health-app connection is read-only. It imports no more than 31 local
calendar days of daily aggregates for sleep, steps, exercise, active energy,
resting heart rate, HRV with method, respiratory rate, oxygen saturation, and
wrist/skin temperature deviation. The app does not request reproductive,
fertility, ECG, location, workout-route, or clinical-record permissions.

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
- Encrypt transport and storage. Do not put health payloads or authorization
  material in logs, crash reports, or analytics.
- Create a research row for every contributed participant-day; sensor-only days
  contain no symptom target.
- “Disconnect and delete imported health data” stops reads, clears the
  encrypted wearable queue/cache, deletes server summaries and their research
  contribution, and preserves manual check-ins. OS authorization must be
  revoked separately in system settings.
- Account deletion removes account-linked operational and research data,
  including the protected identity-to-research mapping.
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
copy must describe model factors as non-causal associations.

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
