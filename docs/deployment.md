# Private-alpha deployment gate

The repository defaults are suitable for local development with synthetic data,
not for collecting real tester health data. Complete this gate before
distributing an internal build to participants.

## Required infrastructure

- Deploy the API behind TLS and set a narrow `ALLOWED_ORIGINS` list.
- Use PostgreSQL on an encrypted volume or managed service with encryption at
  rest, encrypted backups, point-in-time recovery, and private network access.
- Store database and administrator export credentials in a managed secret
  store. Never place them in EAS variables exposed to the client.
- Mount the two restricted phase-model artifacts outside the repository and set
  `PHASE_MODEL_V01_PATH` and `PHASE_MODEL_V02_PATH` to those private files.
  Keep model access covered by the applicable data-use terms. Python 3.12 uses
  the training-time pandas 2.2.2; Python 3.13 uses pandas 2.2.3, the first
  compatible patch release. Both runtimes keep scikit-learn 1.6.1 pinned and
  are model-load tested. Never bake either `.joblib` into a public image layer.
- The v0.1 metadata and prediction routes are deliberately unauthenticated
  developer APIs. Put them behind infrastructure-level request-size limits,
  rate limiting, abuse monitoring, and TLS. CORS is a browser policy, not an
  authentication or rate-limiting control. The v0.2 endpoint remains protected
  by participant authentication and current consent.
- Set a separate `ADMIN_MIGRATION_KEY`. Before deploying consent version
  `2026-07-19-intraday-cycle-v2`, preview legacy opted-out deletion:

  ```bash
  python -m app.migrate_mandatory_research --key "$ADMIN_MIGRATION_KEY"
  ```

  The preview also reports legacy demo check-ins that will be deleted and
  whether the obsolete operational `health_checkins.is_synthetic` column will
  be removed. Review the reported changes, then apply only with explicit
  acknowledgement:

  ```bash
  python -m app.migrate_mandatory_research \
    --key "$ADMIN_MIGRATION_KEY" \
    --apply \
    --acknowledge DELETE-OPTED-OUT-ACCOUNTS
  ```
- Configure retention, backup deletion, access review, incident response, and
  breach-notification ownership before collecting data.
- Run the additive wearable migration after the mandatory-consent migration:

  ```bash
  python -m app.migrate_wearables
  ```

  It creates only missing wearable operational/research tables and is safe to
  rerun.
- Run the additive cycle-tracking migration:

  ```bash
  python -m app.migrate_cycle_tracking
  ```

  It creates only the optional operational preference, history, and sync
  receipt tables and is safe to rerun.
- Disable or redact infrastructure logs that could capture authorization
  headers, query strings, database statements, or health payloads.

The included Docker Compose database and default SQLite database do not provide
these production controls. They must contain synthetic data only.

## Release checks

1. Obtain the appropriate ethics/legal determination for the intended
   participants, jurisdiction, consent language, and research use.
2. Review the exact consent version in the API and mobile build.
3. Exercise enrollment, device unlock, re-consent, offline check-in/health/cycle
   sync, cycle-history deletion, and account deletion against a staging
   deployment using synthetic records.
4. Confirm `/v1/*` responses use `Cache-Control: no-store` and that one account
   cannot access another account's records.
5. Confirm each missing or incompatible phase model returns only its own
   `model_unavailable` state, while `/v1/forecast` and the other phase model
   remain healthy. Exercise the public v0.1 endpoint without credentials and
   the v0.2 endpoint both with and without participant authentication.
6. Run the administrator export into a protected destination and verify the
   schema contains only the documented pseudonymous fields.
7. Run a clean Expo prebuild and internal EAS development builds. Verify
   HealthKit with Apple Watch and Health Connect with Wear OS/compatible
   sources on physical devices, including partial/revoked permissions,
   duplicate sources, cross-midnight sleep, DST/timezone changes, edited or
   deleted records, airplane mode, app restart, and the five-minute lock.
8. Update App Store privacy disclosures and the Google Play Health Apps/Data
   Safety declarations before any distribution that enables health import.

No app-store or public release is authorized by this configuration.
