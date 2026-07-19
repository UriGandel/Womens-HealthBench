# Women's HealthBench (WHB)

Open-source benchmark code and a privacy-oriented mobile research platform for menstrual-health data.

Women's HealthBench defines a reproducible menstrual-phase prediction task over the restricted-access [mcPHASES v1.0.0](https://physionet.org/content/mcphases/1.0.0/) dataset. It also includes a mobile application and API for consented check-ins, read-only wearable summaries, cycle history, experimental wellness forecasts, and research-data collection.

The repository does not redistribute mcPHASES participant records. Authorized researchers can run the benchmark locally under the mcPHASES access and data-use conditions. The public repository contains code, schemas, task definitions, feature dictionaries, manifests, and reviewed aggregate results.

> **Research use only:** No forecast or phase estimate in this project is clinically validated. This software is not a medical device and must not be used for diagnosis, treatment, fertility decisions, contraception, pregnancy decisions, or clinical decision-making.

## What is implemented

The platform contains four distinct prediction or estimation components. They use different inputs and must not be described as one model.

| Component | Purpose | Inputs | Current integration |
|---|---|---|---|
| Next-day symptom score | Estimate whether tomorrow may be a higher-symptom day | Seven or more manual check-ins | Authenticated app endpoint `/v1/forecast`; deterministic transparent score |
| Calendar rules | Estimate current and future cycle phases from recorded bleeding history | Flow and spotting history | Authenticated Cycle screen; rule-based, not an ML model |
| mcPHASES v0.1 | Broad menstrual-phase research reference | Exactly 161 pre-engineered features | Optional public developer API; never called by the mobile app |
| mcPHASES v0.2 | App-compatible current-day menstrual-phase estimate | 26 features derived from seven prior days of wearable summaries | Optional authenticated API called by the mobile Cycle screen |

The two phase-model files are not committed to the repository. They are loaded from private paths when the API starts. Without those files, each phase endpoint safely reports `model_unavailable`; the symptom score, calendar rules, and other application functions continue to work.

## System workflow

```mermaid
flowchart LR
    A[Authorized local mcPHASES data] --> B[Versioned benchmark builders]
    B --> C[v0.1 model and aggregate results]
    B --> D[v0.2 model and aggregate results]
    C --> E[Private backend model mount]
    D --> E

    F[Apple Health or Health Connect] --> G[Read-only daily summaries]
    G --> H[Encrypted on-device queue]
    H --> I[Authenticated FastAPI sync]
    I --> J[Account-isolated database rows]
    J --> K[Seven-day v0.2 feature builder]
    K --> E
    E --> L[Current-day phase label]
    L --> M[Cycle screen]

    N[Manual check-ins and cycle history] --> I
    N --> O[Symptom score and calendar rules]
    O --> M
```

The v0.2 phase label and calendar-rule estimate are displayed as separate signals. They are not averaged or blended into a new model output.

## mcPHASES benchmark task

For each eligible participant-day, predict the participant's current dataset phase using passive wearable summaries from the previous seven complete calendar days.

The four output classes are:

1. `Fertility`
2. `Follicular`
3. `Luteal`
4. `Menstrual`

`Fertility` is a source-dataset class name. It does not mean that an app user is fertile, and it is not confirmation of ovulation.

### Temporal and leakage boundary

- The prediction time is the start of the labelled target day.
- Inputs come only from target day minus 7 through target day minus 1.
- Target-day and future measurements are excluded.
- At least four distinct lookback days must contain a supported passive observation.
- Hormone values, symptoms, participant identity, study interval, target-day values, and previous phase labels are excluded from model inputs.
- Participants, rather than rows, are assigned to the frozen train, validation, and test splits.

## Data and frozen split

The benchmark contains 5,398 eligible participant-days from 42 mcPHASES participants. The deterministic split uses seed `20260719`.

| Split | Participants | Examples |
|---|---:|---:|
| Train | 25 | 3,200 |
| Validation | 8 | 1,029 |
| Test | 9 | 1,169 |
| **Total** | **42** | **5,398** |

No participant appears in more than one split. All four phase classes occur in every split.

## Menstrual-phase models

### v0.1: broad research reference

- **Model version:** `mcphases-broad-0.1.0`
- **Selected model:** Histogram gradient boosting, selected on validation macro-F1
- **Inputs:** 161 engineered features derived from activity, resting heart rate, heart-rate variability, sleep, respiratory rate, and computed temperature
- **Runtime contract:** A caller must submit all 161 pre-engineered features with exact names
- **Mobile use:** None; the app does not produce this feature contract
- **API:** `GET /v1/models/mcphases-phase-v0.1` and `POST /v1/models/mcphases-phase-v0.1/predict`
- **Authentication:** The current code leaves these routes unauthenticated
- **Output:** One phase label; probabilities are withheld

The v0.1 API accepts neither raw mcPHASES files nor mobile wearable records. It exists as an optional developer-facing research interface. If retained in a public deployment, it requires TLS, request-size limits, rate limiting, abuse monitoring, and careful model-artifact handling at the infrastructure layer.

### v0.2: app-compatible research candidate

- **Model version:** `mcphases-app-common-0.2.0`
- **Selected model:** Histogram gradient boosting, selected on validation macro-F1
- **Daily inputs:** Sleep minutes, resting heart rate, RMSSD HRV, respiratory rate, and peripheral-temperature deviation
- **Feature count:** 26
- **API:** `GET /v1/research/phase-forecast?target_date=YYYY-MM-DD`
- **Authentication:** Bearer token and current consent required
- **Output:** One current-day phase label; probabilities are withheld

For each of the five daily measurements, the backend calculates seven-day mean, population standard deviation, minimum, maximum, and non-missing-day count. One additional feature records the number of observed lookback days.

HRV semantics are strict. Only `hrv_ms` values explicitly marked `rmssd` contribute to v0.2. Apple Health SDNN remains missing and is never converted to RMSSD.

The backend reads only the authenticated account's daily summaries from `t−7` through `t−1`. It validates the generated feature names against the model's stored feature order before inference.

## Evaluation

The primary metric is **macro-F1**, which gives equal weight to all four phase classes.

Secondary metrics include balanced accuracy, overall accuracy, weighted F1, per-class precision and recall, log loss, and the confusion matrix. Test macro-F1 uncertainty is estimated with 1,000 participant-cluster bootstrap replicates because multiple days from the same participant are correlated.

The evaluated baselines are:

1. Class-prior baseline
2. Class-balanced multinomial logistic regression
3. Histogram gradient-boosted trees

Model selection uses the validation split. The test split is reserved for final evaluation.

### Reviewed aggregate results

| Metric | v0.1 broad reference | v0.2 app-compatible |
|---|---:|---:|
| Features | 161 | 26 |
| Test macro-F1 | 0.307 | 0.270 |
| 95% participant-bootstrap interval | 0.257–0.357 | 0.225–0.305 |
| Balanced accuracy | 0.313 | 0.272 |
| Accuracy | 0.342 | 0.285 |

| Baseline test macro-F1 | v0.1 | v0.2 |
|---|---:|---:|
| Class prior | 0.118 | 0.118 |
| Multinomial logistic regression | 0.296 | 0.253 |
| Histogram gradient boosting | 0.307 | 0.270 |

Version 0.2 uses 84% fewer features and its observed test macro-F1 is 0.038 lower. This is an observed result, not proof that the true performance is lower: the confidence intervals overlap, and the test set contains only nine participants.

The class-prior baseline has higher accuracy than v0.2 because it predicts only the most common class. It fails to identify three of the four classes, which is why macro-F1 is the primary metric.

## Mobile and API workflow

### 1. Enrollment and consent

1. An adult participant accepts operational processing and research participation.
2. `POST /v1/enroll` creates a random bearer token.
3. The API stores only a SHA-256 hash of the token.
4. A separate random research identifier links pseudonymous research records to the operational account.
5. Native clients store the token in the operating-system secure store.

### 2. Manual check-ins

1. The participant records sleep, stress, five symptom ratings, and period status.
2. The native app writes the check-in to an encrypted SQLCipher queue.
3. The sync worker submits it to `POST /v1/check-ins` with an idempotency identifier.
4. The API stores the operational check-in and rebuilds the pseudonymous research timeline.
5. After seven check-ins, `/v1/forecast` returns the separate transparent next-day symptom score.

The symptom score is a deterministic formula in the current API. It is not either mcPHASES phase model.

### 3. Wearable synchronization

1. The native module requests read-only access to Apple Health or Android Health Connect.
2. The module reads up to 31 local-calendar days of daily summaries and completed six-hour interval summaries.
3. Raw samples, precise sample timestamps, routes, locations, device identifiers, and source-app identifiers are excluded from upload.
4. Daily and interval batches are queued in encrypted local storage.
5. Authenticated, idempotent sync endpoints replace the corresponding account/day or account/day/bucket summaries.
6. All-null records delete an earlier imported summary.

The current integration supports system health stores. It does not directly connect to Fitbit, Garmin, Oura, Bluetooth devices, or watch applications.

### 4. v0.2 phase estimation

1. During app refresh, the client requests the current local date from `/v1/research/phase-forecast`.
2. The API loads the account's prior seven complete daily summaries.
3. It builds the exact 26-feature contract.
4. Fewer than four supported days returns `insufficient_data`.
5. A missing or incompatible model returns `model_unavailable`.
6. A valid mounted model returns one current-day phase label without probability.
7. The Cycle screen compares that label with the rule-derived current-day phase and reports agreement or disagreement.

### 5. Calendar history

Flow and spotting history produces a separate rule-based calendar estimate. Calendar rules may project future days, while the mcPHASES model supplies only the requested target-day label. A missing phase model does not disable the calendar.

### 6. Deletion

- Disconnecting health data deletes imported wearable summaries and their research contribution while preserving manual check-ins.
- Disabling cycle tracking deletes the optional editable cycle history.
- Deleting the account ends participation and deletes operational records, pseudonymous research rows, sync receipts, consent records, and the account-to-research mapping through the implemented deletion workflow and database relationships.

## Repository structure

- `apps/mobile`: Expo React Native application, native health-store module, encrypted offline queues, enrollment, consent, check-ins, symptom forecast, Cycle screen, wearable sync, and privacy controls.
- `services/api`: FastAPI application, bearer-token authentication, SQLAlchemy models, PostgreSQL or SQLite storage, phase-model loading, prediction routes, deletion flows, migrations, and research export.
- `benchmark`: Synthetic symptom-benchmark package and the mcPHASES v0.1 builder and aggregate artifacts.
- `mcphases_app_common_v02_results`: Reviewed v0.2 task definition, feature contract, manifest, dictionary, and aggregate results.
- `schemas`: Public JSON schemas for pseudonymous research records.
- `docs`: Benchmark, deployment, health-data, privacy, and schema documentation.
- `MODEL_CARD.md`: The synthetic symptom benchmark and the live transparent symptom-score boundary, with an additional section describing the phase models.

## Quick start

### API

The API supports Python 3.12 and 3.13. Its model-serving environment pins scikit-learn 1.6.1 and a Python-compatible pandas 2.2 patch release.

```bash
cd services/api
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/uvicorn app.main:app --reload
```

SQLite is the default local-development database. It must contain synthetic or disposable development data only.

For local PostgreSQL:

```bash
docker compose up -d db
DATABASE_URL=postgresql+psycopg://healthbench:healthbench@localhost:5432/healthbench \
  .venv/bin/uvicorn app.main:app --reload
```

Interactive API documentation is available at <http://127.0.0.1:8000/docs>.

To enable optional phase inference, mount the two private model files and set:

```bash
PHASE_MODEL_V01_PATH=/secure/path/mcphases_phase_model_v01.joblib
PHASE_MODEL_V02_PATH=/secure/path/selected_phase_model.joblib
```

Do not place untrusted `.joblib` files at these paths. Python model deserialization can execute code, so only load artifacts produced and verified by the project pipeline.

### Mobile

```bash
cd apps/mobile
npm install
npm start
```

`EXPO_PUBLIC_API_URL` defaults to `http://127.0.0.1:8000`. Android emulators normally reach the host API at `http://10.0.2.2:8000`.

The SQLCipher store, secure token storage, device authentication, and native health-store module require an Expo development build rather than Expo Go:

```bash
npx expo prebuild --clean --no-install
npm run ios
# or
npm run android
```

The browser preview is limited to non-native flows. It skips device authentication, disables health-store import, and keeps tokens and queues only in memory until page reload.

### Benchmark

```bash
cd benchmark
python3 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/healthbench-benchmark --output artifacts/report.json
.venv/bin/pytest
```

The default command runs the separate deterministic synthetic symptom benchmark. Rebuilding the mcPHASES phase benchmarks requires authorized local access to mcPHASES and the version-specific builder scripts.

## Deployment boundary

The repository defaults are for development, not real participant data.

Before real testing:

- Deploy the API behind TLS.
- Use encrypted PostgreSQL storage and encrypted backups.
- Restrict database and model-file access.
- Apply the documented migrations; startup only creates missing tables and does not alter existing tables.
- Configure a narrow CORS origin list.
- Protect the public v0.1 API with infrastructure-level size limits, rate limiting, and abuse monitoring, or disable it if a public prediction API is not part of the intended product.
- Test account isolation, consent versioning, sync idempotency, model-unavailable behavior, and deletion.
- Verify Apple Health and Health Connect behavior on physical devices.
- Complete the required ethics, privacy, security, legal, and platform-policy review.

See [`docs/deployment.md`](docs/deployment.md) before inviting testers.

## Reproducibility artifacts

Each phase-benchmark release should contain:

- Task specification
- Feature dictionary
- Machine-readable feature contract where applicable
- Source-file hashes
- Benchmark manifest
- Frozen split rules and seed
- Aggregate baseline metrics
- Run metadata
- Intended-use and limitation statements

Raw mcPHASES records, participant feature tables, participant split identities, and row-level predictions are not public benchmark artifacts.

## Limitations

- Only 42 participants were eligible for this benchmark.
- The test split contains nine participants.
- No independent external cohort has been evaluated.
- Phase-model probability calibration is poor, so probabilities are withheld.
- Performance is uneven across phase classes.
- The source cohort and Fitbit-derived measurements may not represent the intended app population or Apple Health and Health Connect measurements.
- iOS supplies HRV as SDNN, which is excluded from the RMSSD-only v0.2 feature.
- Transfer of temperature and other measurement definitions from mcPHASES to app data remains unvalidated.
- The models do not establish clinical utility, individual reliability, subgroup fairness, or safety.
- The v0.1 and v0.2 confidence intervals overlap; the observed score difference is not proof of a true performance difference.

## Licence and citation

Repository source code is released under the repository's MIT licence unless a file states otherwise.

The repository licence does not relicense mcPHASES. Use of mcPHASES and artifacts derived from it remains subject to the applicable PhysioNet access and data-use conditions reviewed by the user or deploying organization.

When using mcPHASES, cite:

> Lin, B., Li, J. Y., Kalani, K., Truong, K., & Mariakakis, A. (2025). *mcPHASES: A Dataset of Physiological, Hormonal, and Self-reported Events and Symptoms for Menstrual Health Tracking with Wearables* (version 1.0.0). PhysioNet. <https://doi.org/10.13026/zx6a-2c81>

See the [mcPHASES project page](https://physionet.org/content/mcphases/1.0.0/) for the current access terms and citation instructions.

