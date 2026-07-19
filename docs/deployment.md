# Private-alpha deployment gate

The repository defaults are suitable for synthetic local demonstrations, not
for collecting real tester health data. Complete this gate before distributing
an internal build to participants.

## Required infrastructure

- Deploy the API behind TLS and set a narrow `ALLOWED_ORIGINS` list.
- Use PostgreSQL on an encrypted volume or managed service with encryption at
  rest, encrypted backups, point-in-time recovery, and private network access.
- Store database and administrator export credentials in a managed secret
  store. Never place them in EAS variables exposed to the client.
- Replace the demo invitation with single-use, short-lived invitations and set
  `DEMO_MODE=false`.
- Configure retention, backup deletion, access review, incident response, and
  breach-notification ownership before collecting data.
- Disable or redact infrastructure logs that could capture authorization
  headers, query strings, database statements, or health payloads.

The included Docker Compose database and default SQLite database do not provide
these production controls. They must contain synthetic data only.

## Release checks

1. Obtain the appropriate ethics/legal determination for the intended
   participants, jurisdiction, consent language, and research use.
2. Review the exact consent version in the API and mobile build.
3. Exercise enrollment, offline sync, withdrawal, and deletion against a
   staging deployment using synthetic records.
4. Confirm `/v1/*` responses use `Cache-Control: no-store` and that one account
   cannot access another account's records.
5. Run the administrator export into a protected destination and verify the
   schema contains only the documented pseudonymous fields.
6. Build with the internal EAS profiles and test SQLCipher behavior on physical
   iOS and Android devices, including airplane mode and app restart.

No app-store or public release is authorized by this configuration.
