# Tomorrow, Gently — private symptom forecasting

Tomorrow, Gently is a private, internal-distribution mobile alpha for
forecasting whether tomorrow may be a higher-symptom day. It is an experimental
wellness tool, not a diagnostic product.

The repository contains:

- `apps/mobile`: native Expo React Native application for enrollment, consent,
  daily check-ins, read-only Apple Health/Health Connect imports, forecasts,
  and privacy controls.
- `services/api`: FastAPI service with PostgreSQL/SQLite support, pseudonymous
  research storage, and an administrator-only export command.
- `benchmark`: reproducible synthetic benchmark plus an adapter contract for
  restricted mcPHASES data.
- `schemas`: public JSON schemas for the reusable research asset.
- `docs`: benchmark, privacy, and threat-boundary documentation.

## Quick start

### API

```bash
cd services/api
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/uvicorn app.main:app --reload
```

SQLite is used by default for local development with synthetic data only. For PostgreSQL:

```bash
docker compose up -d db
DATABASE_URL=postgresql+psycopg://healthbench:healthbench@localhost:5432/healthbench \
  .venv/bin/uvicorn app.main:app --reload
```

The interactive API documentation is at `http://127.0.0.1:8000/docs`.

### Mobile

```bash
cd apps/mobile
npm install
EXPO_PUBLIC_API_URL=http://127.0.0.1:8000 npm start
```

Android emulators reach a host API through `http://10.0.2.2:8000`; set
`EXPO_PUBLIC_API_URL` accordingly.

The encrypted offline queues and local HealthKit/Health Connect module require
an Expo development build rather than Expo Go. Device authentication also
requires a configured system passcode, Face ID, or fingerprint:

```bash
npx expo prebuild
npm run ios
# or
npm run android
```

For a browser-only preview of the non-native flows:

```bash
EXPO_PUBLIC_API_URL=http://127.0.0.1:8000 npm run web
```

The browser preview skips device authentication, disables Apple Health and
Health Connect imports, and keeps tokens and queued records in volatile memory
that is cleared on reload.

### Benchmark

```bash
cd benchmark
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/healthbench-benchmark --output artifacts/report.json
.venv/bin/pytest
```

The benchmark generates deterministic synthetic data by default. Restricted
mcPHASES records are never committed or redistributed.

## Safety boundary

- Operational processing and pseudonymous research contribution are both
  explicit conditions of participation.
- The API never logs request bodies or authorization headers.
- Research rows use a random research identifier and relative `day_in_study`.
- Wearable imports contain only daily aggregates; raw samples, timestamps,
  routes, locations, source apps, and device identifiers are excluded.
- Deleting an account ends participation and deletes operational check-ins,
  wearable summaries, pseudonymous research rows, and the account mapping.
- No tester or mcPHASES record-level data belongs in the open-source artifact.

SQLite API mode is a development tool and must not hold real tester data. The
production client remains native; the volatile web adapter is for local testing
only.
Before inviting testers, follow
[docs/deployment.md](docs/deployment.md) and provision encrypted PostgreSQL
storage with TLS.

See [docs/health-data.md](docs/health-data.md),
[docs/privacy.md](docs/privacy.md), and [MODEL_CARD.md](MODEL_CARD.md).
