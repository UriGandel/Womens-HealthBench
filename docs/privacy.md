# Privacy and research data policy

## Separation of purposes

Operational consent is required to provide the private forecasting service.
Research contribution is a separate, optional choice. Declining or withdrawing
research consent must not prevent ordinary app use. Consent version and changes
are auditable.

The account store holds invitations and operational identity. The research
store uses a random research identifier connected through a separately
protected mapping. The research representation uses `day_in_study`, not
calendar dates, and excludes account identifiers, names, email addresses,
free text, device and advertising identifiers, IP addresses, location, and
contacts.

These records are **pseudonymous, not anonymous**. Removing direct identifiers
does not eliminate re-identification risk, especially in longitudinal health
data.

## Data lifecycle

- Collect only the structured fields documented in the public schema.
- Encrypt transport and storage. Do not put health payloads or authorization
  material in logs, crash reports, or analytics.
- Create research rows only while research opt-in is effective. Withdrawal
  deletes contributed research rows; account deletion removes account-linked
  operational and research data.
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

- Research opt-out produces zero research rows.
- Consent withdrawal removes prior research contribution as promised.
- Account deletion removes all account-linked rows and mapping keys.
- Exports have no direct/account identifiers, absolute dates, free text, device
  IDs, network identifiers, or location.
- Logs and analytics contain no check-in payloads.
- Unauthorized accounts cannot read or delete another participant's data.
