# Tomorrow, Gently — private symptom forecasting

Tomorrow, Gently is a private, internal-distribution mobile alpha for
forecasting whether tomorrow may be a higher-symptom day. It is an experimental
wellness tool, not a diagnostic product.

The repository contains:

- `apps/mobile`: Expo React Native application for invitation, consent, daily
  check-ins, forecasts, and privacy controls.
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
DEMO_MODE=true DEMO_INVITE_CODE=ALPHA-2026 .venv/bin/uvicorn app.main:app --reload
```

SQLite is used by default for a zero-configuration demo. For PostgreSQL:

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

Use invitation code `ALPHA-2026` in demo mode. Android emulators reach a host
API through `http://10.0.2.2:8000`; set `EXPO_PUBLIC_API_URL` accordingly.

The encrypted offline queue uses SQLCipher and therefore requires an Expo
development build rather than Expo Go:

```bash
npx expo prebuild
npm run ios
# or
npm run android
```

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

- Operational processing and optional research contribution use separate
  consent controls.
- The API never logs request bodies or authorization headers.
- Research rows use a random research identifier and relative `day_in_study`.
- Withdrawal deletes pseudonymous research rows; account deletion deletes all
  account-linked data.
- No tester or mcPHASES record-level data belongs in the open-source artifact.

SQLite API mode and the volatile web adapter are development/demo tools and
must not hold real tester data. Before inviting testers, follow
[docs/deployment.md](docs/deployment.md) and provision encrypted PostgreSQL
storage with TLS.

See [docs/privacy.md](docs/privacy.md) and [MODEL_CARD.md](MODEL_CARD.md).
