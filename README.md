# Women's Health Bench (WHB)

**Open benchmark for menstrual phase prediction using wearable physiological data.**

Women's Health Bench (WHB) is an open, reproducible benchmark designed to predict a participant's current menstrual phase using only wearable physiological data collected over the previous seven days. The project provides a standardized evaluation framework for researchers building AI models for women's hormonal health.

## Key Features

-  Predicts four menstrual phases:
  - Menstrual
  - Follicular
  - Fertility
  - Luteal
-  Uses only the previous seven days of wearable physiological signals
-  Prevents temporal data leakage by excluding current-day and future information
-  Generates **161 engineered features** through rolling-window feature engineering
-  Fully reproducible preprocessing and feature engineering pipeline
-  Open-source AI infrastructure for women's hormonal health research

> **Disclaimer:** Women's Health Bench is intended for research and benchmarking purposes only. It is **not** a medical device and should not be used for diagnosis, treatment, or clinical decision-making.

The repository contains:

- `apps/mobile`: native Expo React Native application for enrollment, consent,
  daily check-ins, read-only Apple Health/Health Connect imports, forecasts,
  a 14-day symptom history strip, and privacy controls.
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

Plain `postgresql://` (or legacy `postgres://`) URLs, as issued by hosted
providers such as Render, are automatically rewritten to use the installed
psycopg 3 driver — no manual `+psycopg` suffix is required.

The interactive API documentation is at `http://127.0.0.1:8000/docs`.

### Mobile

```bash
cd apps/mobile
npm install
npm start
```

`EXPO_PUBLIC_API_URL` defaults to `http://127.0.0.1:8000`; set it only when
the API runs elsewhere. Android emulators reach a host API through
`http://10.0.2.2:8000`.

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
npm run web
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

## Deployment

The API could be run on Render and the browser preview on Vercel:

- **Render (API)**: start command
  `uvicorn app.main:app --host 0.0.0.0 --port $PORT` from `services/api`, with
  `DATABASE_URL` pointing at a Render PostgreSQL instance (the plain
  `postgresql://` URL Render provides works as-is).
- **Vercel (web preview)**: serves the `apps/mobile` browser preview, with
  `EXPO_PUBLIC_API_URL` set to the deployed API origin. The preview keeps the
  same limitations as the local `npm run web` preview described above.

Both services are configured in their dashboards; there is no `render.yaml` or
`vercel.json` in the repository.

Startup only creates missing tables; it never alters existing ones. After
changing a model on an existing database, apply the column change manually (or
reset the database — alpha data is disposable).

See [docs/deployment.md](docs/deployment.md) before inviting real testers.

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
