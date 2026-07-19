# Women's HealthBench: mcPHASES Benchmark Methodology

## Purpose

This benchmark tests whether recent passive wearable measurements contain enough information to predict a participant's current menstrual-cycle phase.

The prediction is experimental. It is not a diagnosis, a fertility test, or a medical recommendation.

## Data source

- Dataset: mcPHASES version 1.0.0
- Source: PhysioNet
- DOI: https://doi.org/10.13026/zx6a-2c81
- Eligible benchmark data: 5,398 participant-days from 42 participants

The original mcPHASES records remain governed by PhysioNet's access conditions. This repository does not redistribute participant-level source data, participant identifiers, row-level predictions, or private split files.

## Prediction task

For each eligible participant-day, the model predicts one of four phases:

1. Fertility
2. Follicular
3. Luteal
4. Menstrual

The model can use only passive wearable measurements from the seven complete calendar days before the target day. A sample is eligible only when at least four of those seven days contain observations.

The phase label for the target day is used only as the outcome. Hormone measurements, symptom reports, participant identity, study interval, target-day wearable measurements, and earlier phase labels are not model inputs. This restriction reduces direct label leakage.

## Unit of analysis

One example represents one participant on one labelled study day.

The prediction time is the start of that day. Therefore, the model receives no measurements recorded during or after the day it is asked to predict.

## Data preparation

The preparation pipeline performs the following operations:

1. Verify the expected source files and their SHA-256 hashes.
2. Parse and standardize participant, timestamp, and measurement fields.
3. Remove exact duplicate rows within each source table.
4. Preserve non-identical observations that share a day or timestamp.
5. Reduce multiple same-day observations using a prespecified daily median.
6. Construct the target phase label for each participant-day.
7. Build a seven-day lookback window ending before the target day.
8. Exclude examples with fewer than four observed lookback days.
9. Create summary features using training-independent rules.
10. Assign each participant to exactly one frozen dataset split.

## Frozen participant split

The benchmark uses a deterministic participant-level split with seed `20260719`:

| Split | Participants | Examples |
|---|---:|---:|
| Train | 25 | 3,200 |
| Validation | 8 | 1,029 |
| Test | 9 | 1,169 |
| Total | 42 | 5,398 |

No participant appears in more than one split. This is essential because random row-level splitting would allow the model to see the same person's patterns during training and testing.

All four outcome classes are represented in every split.

## Benchmark version 0.1: broad wearable baseline

Version 0.1 uses passive measurements from:

- Activity minutes
- Resting heart rate
- Heart-rate variability
- Sleep
- Respiratory rate
- Computed temperature

After daily and seven-day aggregation, this produces 161 model features. Version 0.1 is the broad research baseline. Some of its fields do not map cleanly to the current mobile application's common Apple Health and Android Health Connect data contract.

## Benchmark version 0.2: app-compatible feature contract

Version 0.2 uses five daily measurements that can be represented consistently by the application:

- Sleep duration in minutes
- Resting heart rate in beats per minute
- Heart-rate variability measured as RMSSD in milliseconds
- Respiratory rate in breaths per minute
- Peripheral temperature change in degrees Celsius

For each measurement, the preceding seven days are summarized using:

- Mean
- Population standard deviation
- Minimum
- Maximum
- Number of non-missing days

These summaries create 25 features. One additional feature records the number of observed lookback days, producing 26 features in total.

Apple Health may provide HRV as SDNN rather than RMSSD. These two measurements are not treated as interchangeable. An SDNN value is left missing instead of being converted into RMSSD without scientific justification.

The following app fields are deliberately excluded from version 0.2:

- Steps
- Activity minutes
- Active energy
- Oxygen saturation
- SDNN heart-rate variability
- Manually entered cycle day
- Period status
- Symptoms

Some fields are excluded because they are absent from the frozen app-common benchmark contract. Cycle and symptom fields are also excluded to prevent the model from receiving direct clues about the target label.

## Models evaluated

Three reproducible baselines are evaluated:

1. **Class-prior baseline:** always predicts according to the training-set class distribution.
2. **Class-balanced multinomial logistic regression:** a simple linear baseline.
3. **Histogram gradient-boosted trees:** a nonlinear tabular-data baseline.

Model selection is performed using the validation split. The test split is reserved for the final evaluation.

## Evaluation protocol

The primary metric is macro-F1. Macro-F1 calculates an F1 score for each phase and then gives all four phases equal weight. It is more informative than accuracy when classes are unevenly represented.

Secondary measures are:

- Balanced accuracy
- Overall accuracy
- Weighted F1
- Recall for each phase
- Log loss
- Confusion matrix

Uncertainty in test macro-F1 is estimated using 1,000 participant-cluster bootstrap replicates. Participants, rather than individual rows, are resampled because multiple days from the same participant are correlated.

## Test results

| Version and model | Features | Macro-F1 | 95% participant-bootstrap interval | Balanced accuracy | Accuracy |
|---|---:|---:|---:|---:|---:|
| Class-prior baseline | — | 0.118 | 0.108–0.131 | 0.250 | 0.311 |
| v0.1 histogram gradient boosting | 161 | 0.307 | 0.257–0.357 | 0.313 | 0.342 |
| v0.2 histogram gradient boosting | 26 | 0.270 | 0.225–0.305 | 0.272 | 0.285 |

Version 0.1 produced the strongest test macro-F1. Version 0.2 used 84% fewer features and had a macro-F1 decrease of 0.038. Its value is compatibility with the application's feature contract, not improved predictive performance.

The confidence intervals overlap. With only 42 participants, the available evidence does not establish that the true performance of the two versions is different.

The class-prior baseline has higher accuracy than the v0.2 model because it predicts the most common class. However, it fails to detect three of the four phases and therefore has a much lower macro-F1. Accuracy alone would give a misleading picture of performance.

### Per-class results for version 0.2

| Phase | Precision | Recall | F1 |
|---|---:|---:|---:|
| Fertility | 0.306 | 0.270 | 0.287 |
| Follicular | 0.262 | 0.202 | 0.228 |
| Luteal | 0.321 | 0.416 | 0.362 |
| Menstrual | 0.202 | 0.201 | 0.202 |

These results show that the model performs unevenly across phases. They do not support user-facing claims that the application can reliably identify an individual's phase.

## What the results establish

The experiment establishes that:

- The task, inputs, labels, exclusions, splits, baselines, and metrics can be specified reproducibly.
- Participant-level splitting can be used to prevent the most direct form of identity leakage.
- Passive wearable summaries contain a signal above the class-prior macro-F1 baseline in this dataset.
- A smaller 26-feature contract can connect the research pipeline to measurements the application can represent.

## What the results do not establish

The experiment does not establish:

- Clinical accuracy or clinical usefulness
- Reliable prediction for a new population
- Fertility, pregnancy, disease, or hormone diagnosis
- Safety for unsupervised use in the mobile application
- Causal relationships between wearable signals and menstrual phase
- Fair performance across ages, ethnicities, devices, health conditions, or irregular cycles

The dataset contains only 42 eligible participants and has no external test cohort. The observations are longitudinal and correlated. Device and measurement differences may also affect transfer to real application data.

## Intended application use

Version 0.2 is an app-compatible research candidate. The mobile platform may use its feature contract to collect compatible measurements and to demonstrate how an inference service would operate.

Until prospective and external validation are completed, predictions should be shown only as experimental research output or disabled in user-facing health decisions. The application must not present the output as medical advice.

## Reproducibility and versioning

Each benchmark release should include:

- A task specification
- A feature dictionary
- A machine-readable feature contract
- Source-file hashes
- A benchmark manifest
- Frozen split rules and seed
- Baseline metrics
- Run metadata
- Model and data limitations

New versions must not silently replace old results. Any change to labels, eligibility rules, features, preprocessing, splits, models, or metrics requires a new version number and a written change log.

## Next scientific steps

1. Reproduce both benchmark versions from a clean environment.
2. Add automated tests for temporal leakage, participant overlap, schema mismatches, and duplicate handling.
3. Validate the 26-feature contract using prospectively collected app data.
4. Evaluate calibration before displaying probabilities.
5. Test on a larger external cohort with broader demographic and clinical representation.
6. Define subgroup analyses before examining subgroup results.
7. Conduct clinical and ethics review before any health-related deployment.

## Contribution

Benchmark task design, data audit, feature-contract analysis, training, evaluation, and scientific documentation were contributed by **Anirudh Gangadharan** as part of the Women's HealthBench team.

